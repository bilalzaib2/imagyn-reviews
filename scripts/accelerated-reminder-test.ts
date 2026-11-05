/*
 * Accelerated review-request lifecycle harness.
 *
 * Walks the COMPLETE workflow — test request -> initial email -> first reminder -> final
 * reminder -> review submission -> reminder cancellation — through the real production
 * scheduling and dispatch code, compressed from 7 days into a few minutes.
 *
 * HOW THE ACCELERATION WORKS, and why no production timing is touched.
 *
 * runDueReviewRequestSweep and runDueReminderSweep both already accept an injectable `now`
 * (their only parameter). A reminder is due when `sentAt <= now - store.reminderNDelayDays`.
 * So the harness never changes a delay, an interval, or a schedule: it changes only the clock
 * it hands the sweep. SWEEP_INTERVAL_MS, the 3/7-day defaults, and every stored delay are
 * read and honoured exactly as production reads them. Nothing in app/ is modified to make this
 * run, and the harness is not imported by any application code.
 *
 * WHAT IS REAL HERE: the sweeps, the per-store candidate SQL, the pre-send claim and its
 * rollback, the reminder fields, the suppression checks, the plan entitlement check, the
 * template rendering, and every database write. The ONLY substitution is the email provider,
 * swapped to the in-process capture provider (EMAIL_PROVIDER=capture) unless --live is passed.
 *
 * SAFETY
 *  - Refuses to run unless DATABASE_URL points at localhost/127.0.0.1. A remote or Railway
 *    host aborts before a single statement is issued.
 *  - Refuses to run without --i-understand-this-writes-to-my-local-db.
 *  - Creates its own store/product/request rows under an unmistakable prefix and deletes
 *    every one of them in a finally block. It never reads, updates, or deletes a row it did
 *    not create.
 *  - --live sends real email through Resend and is additionally restricted to a single
 *    hard-coded recipient. There is no flag to widen that.
 *
 * USAGE
 *   npx tsx scripts/accelerated-reminder-test.ts --i-understand-this-writes-to-my-local-db
 *   npx tsx scripts/accelerated-reminder-test.ts --i-understand-this-writes-to-my-local-db --live
 *   ... add --fast to collapse the wall-clock waits (same assertions, no 5-minute run).
 */
import { randomUUID } from "node:crypto";

// The only address this harness may ever deliver real mail to. Authorised by the project
// owner for exactly this purpose. Not configurable by flag or environment on purpose.
const AUTHORISED_LIVE_RECIPIENT = "bilal.zaib@outlook.com";

const ROW_PREFIX = "imagyn-accel-test";

const argv = new Set(process.argv.slice(2));
const LIVE = argv.has("--live");
const FAST = argv.has("--fast");
const ACKNOWLEDGED = argv.has("--i-understand-this-writes-to-my-local-db");

// Loads .env the way the app itself does when Vite/react-router boots it. A bare `tsx` run
// has no env, which would otherwise look identical to a missing DATABASE_URL.
function loadEnvFile(): void {
  const loader = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile;
  if (typeof loader !== "function") {
    return;
  }
  try {
    loader(".env");
  } catch {
    // No .env present — the checks below report whatever is (or is not) already in the
    // environment, which is the correct behaviour for a CI-style run.
  }
}

function fail(message: string): never {
  console.error(`\n  ABORTED: ${message}\n`);
  process.exit(1);
}

function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) {
    fail("DATABASE_URL is not set.");
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    fail("DATABASE_URL could not be parsed; refusing to guess which database this is.");
  }

  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    fail(
      `DATABASE_URL points at "${host}", which is not local. This harness writes rows and will ` +
        `only ever do so against a local database. Point DATABASE_URL at a disposable local ` +
        `Postgres and run it again.`,
    );
  }

  console.log(`  database: ${host} (local) — ok`);
}

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function waitUntilMinute(minute: number, startedAt: number): Promise<void> {
  if (FAST) {
    console.log(`\n--- minute ${minute} (fast mode, no wait) ---`);
    return;
  }
  const target = startedAt + minute * MINUTE_MS;
  const remaining = target - Date.now();
  if (remaining > 0) {
    console.log(`\n--- waiting ${Math.round(remaining / 1000)}s for minute ${minute} ---`);
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  console.log(`\n--- minute ${minute} ---`);
}

const checks: Array<{ label: string; ok: boolean; detail?: string }> = [];

function check(label: string, ok: boolean, detail?: string): void {
  checks.push({ label, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  console.log("\nAccelerated review-request lifecycle harness\n");

  loadEnvFile();

  if (!ACKNOWLEDGED) {
    fail(
      "This harness writes test rows to the database it is pointed at. Re-run with " +
        "--i-understand-this-writes-to-my-local-db once you have confirmed DATABASE_URL is local.",
    );
  }

  assertLocalDatabase();

  if (LIVE) {
    if (!process.env.RESEND_API_KEY) {
      fail("--live needs RESEND_API_KEY.");
    }
    if (!process.env.RESEND_FROM_EMAIL) {
      fail(
        "--live needs RESEND_FROM_EMAIL set to an address on a domain verified in your Resend " +
          "account. It is currently empty, so Resend would reject every send.",
      );
    }
    console.log(`  mode: LIVE — real email to ${AUTHORISED_LIVE_RECIPIENT} only`);
  } else {
    process.env.EMAIL_PROVIDER = "capture";
    console.log("  mode: CAPTURE — no message leaves this process");
  }

  // Imported after EMAIL_PROVIDER is set, so the provider switch resolves correctly.
  const { default: prisma } = await import("../app/db.server");
  const { runDueReviewRequestSweep, runDueReminderSweep } = await import(
    "../app/services/reviewRequestScheduler.server"
  );
  const { reviewRequestService } = await import("../app/services/review-request.server");
  const { getCapturedEmails, clearCapturedEmails } = await import(
    "../app/services/notifications/capture.server"
  );

  const runId = randomUUID().slice(0, 8);
  const recipient = LIVE ? AUTHORISED_LIVE_RECIPIENT : `${ROW_PREFIX}-${runId}@example.com`;
  const slug = `${ROW_PREFIX}-${runId}`;

  let storeId: string | null = null;

  try {
    // ---- Fixture -------------------------------------------------------------------
    // A dedicated store on the Pro plan (reminders are a Pro entitlement and the sweep
    // re-checks it), with reminders switched on and remindersEnabledAt backdated so the
    // request this harness creates is inside the eligibility window.
    const store = await prisma.store.create({
      data: {
        // Realistic for the same reason as in live-email-header-test.ts: this name becomes
        // the From display name on every message this harness sends.
        name: "Coastal Threads",
        slug,
        domain: `${slug}.myshopify.com`,
        plan: "growth",
        planStatus: "active",
        reminderEmailsEnabled: true,
        remindersEnabledAt: new Date(Date.now() - DAY_MS),
      },
    });
    storeId = store.id;

    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        shopifyProductId: `gid://shopify/Product/${runId}`,
        name: "Accelerated Test Product",
        handle: `${slug}-product`,
      },
    });

    console.log(`  fixture: store ${store.slug}, delays ${store.reminder1DelayDays}/${store.reminderFinalDelayDays} days`);
    console.log(`  recipient: ${recipient}`);

    const startedAt = Date.now();
    clearCapturedEmails();

    // ---- Minute 1: the initial review request --------------------------------------
    await waitUntilMinute(1, startedAt);

    // delayDays 1 so the row lands on "scheduled" (the real sweep's input) rather than being
    // dispatched inline at creation time, then scheduledFor is pulled back so it is due now.
    const created = await reviewRequestService.createRequest(store.id, {
      productId: product.id,
      email: recipient,
      name: "Bilal",
      orderNumber: `#${runId}`,
      delayDays: 1,
    });

    await prisma.reviewRequest.update({
      where: { id: created.request.id },
      data: { scheduledFor: new Date(Date.now() - MINUTE_MS) },
    });

    const initialSweep = await runDueReviewRequestSweep(new Date());
    const afterInitial = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: created.request.id } });

    check("initial request dispatched by the real Day-0 sweep", initialSweep.dispatched === 1, `dispatched=${initialSweep.dispatched}`);
    check("request reached status 'sent' with sentAt set", afterInitial.status === "sent" && afterInitial.sentAt !== null, `status=${afterInitial.status}`);

    if (!LIVE) {
      const initial = getCapturedEmails().filter((email) => !email.tags?.email_type);
      check("exactly one initial email", initial.length === 1, `count=${initial.length}`);
      check("initial email addressed to the recipient", initial[0]?.to === recipient);
      check("sender name is the store, not Imagyn", initial[0]?.fromName === store.name, `fromName=${initial[0]?.fromName}`);
      check("initial email has a subject and both bodies", Boolean(initial[0]?.subject && initial[0]?.html && initial[0]?.text));
    }

    // A second Day-0 sweep must not re-send: the row is no longer "scheduled".
    const initialRepeat = await runDueReviewRequestSweep(new Date());
    check("initial email is not duplicated by a second sweep", initialRepeat.dispatched === 0, `dispatched=${initialRepeat.dispatched}`);

    // Hard stop rather than a TypeError further down: every reminder cutoff is anchored to
    // sentAt, so without it the rest of the timeline is meaningless. This is exactly how the
    // harness surfaced the dispatchRequestEmail defect that left sentAt null on every
    // scheduled request.
    if (!afterInitial.sentAt) {
      check("sentAt is stamped, so reminders can be anchored", false, "sentAt is null — reminder sweep can never select this row");
      throw new Error("Aborting: the initial dispatch did not stamp sentAt, so no reminder can ever be due.");
    }

    const sentAt = afterInitial.sentAt;

    // ---- Minute 3: the first reminder ----------------------------------------------
    // The clock is advanced past this store's own reminder1DelayDays; the delay itself is
    // untouched and still read from the store row by the sweep.
    await waitUntilMinute(3, startedAt);

    const reminder1Clock = new Date(sentAt.getTime() + store.reminder1DelayDays * DAY_MS + MINUTE_MS);
    const reminder1Sweep = await runDueReminderSweep(reminder1Clock);
    const afterReminder1 = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: created.request.id } });

    check("first reminder dispatched", reminder1Sweep.dispatched === 1, `dispatched=${reminder1Sweep.dispatched}`);
    check("reminder1SentAt stamped exactly once", afterReminder1.reminder1SentAt !== null);
    check("no claim leaked", reminder1Sweep.claimLeaks === 0, `claimLeaks=${reminder1Sweep.claimLeaks}`);
    check("reminder did not regress the request status", afterReminder1.status === "sent", `status=${afterReminder1.status}`);

    const reminder1Repeat = await runDueReminderSweep(reminder1Clock);
    check("first reminder is not duplicated by a repeat sweep", reminder1Repeat.dispatched === 0, `dispatched=${reminder1Repeat.dispatched}`);

    if (!LIVE) {
      const firstReminders = getCapturedEmails().filter((email) => email.tags?.email_type === "reminder_1");
      check("exactly one reminder_1 email", firstReminders.length === 1, `count=${firstReminders.length}`);
    }

    // ---- Minute 5: the final reminder ----------------------------------------------
    await waitUntilMinute(5, startedAt);

    const finalClock = new Date(sentAt.getTime() + store.reminderFinalDelayDays * DAY_MS + MINUTE_MS);
    const finalSweep = await runDueReminderSweep(finalClock);
    const afterFinal = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: created.request.id } });

    check("final reminder dispatched", finalSweep.dispatched === 1, `dispatched=${finalSweep.dispatched}`);
    check("reminderFinalSentAt stamped exactly once", afterFinal.reminderFinalSentAt !== null);

    const finalRepeat = await runDueReminderSweep(finalClock);
    check("final reminder is not duplicated by a repeat sweep", finalRepeat.dispatched === 0, `dispatched=${finalRepeat.dispatched}`);

    if (!LIVE) {
      const finals = getCapturedEmails().filter((email) => email.tags?.email_type === "reminder_final");
      check("exactly one reminder_final email", finals.length === 1, `count=${finals.length}`);
      check(
        "three emails in total across the whole lifecycle",
        getCapturedEmails().length === 3,
        `count=${getCapturedEmails().length}`,
      );
    }

    // ---- Review submission stops everything ----------------------------------------
    // A fresh request, reminder-eligible, then marked reviewed: the sweep must ignore it.
    const reviewedRequest = await prisma.reviewRequest.create({
      data: {
        storeId: store.id,
        productId: product.id,
        email: `${ROW_PREFIX}-${runId}-reviewed@example.com`,
        name: "Reviewed Customer",
        delayDays: 0,
        status: "sent",
        sentAt,
        requestToken: randomUUID(),
        reviewedAt: new Date(),
      },
    });

    const afterReviewSubmission = await runDueReminderSweep(finalClock);
    const reviewedRow = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: reviewedRequest.id } });
    check(
      "a submitted review stops all further reminders",
      afterReviewSubmission.dispatched === 0 && reviewedRow.reminder1SentAt === null,
      `dispatched=${afterReviewSubmission.dispatched}`,
    );

    // ---- Cancellation ---------------------------------------------------------------
    const cancelled = await prisma.reviewRequest.create({
      data: {
        storeId: store.id,
        productId: product.id,
        email: `${ROW_PREFIX}-${runId}-cancelled@example.com`,
        name: "Cancelled Customer",
        delayDays: 0,
        status: "cancelled",
        sentAt,
        requestToken: randomUUID(),
      },
    });

    const afterCancel = await runDueReminderSweep(finalClock);
    const cancelledRow = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: cancelled.id } });
    check(
      "a cancelled request never receives a reminder",
      afterCancel.dispatched === 0 && cancelledRow.reminder1SentAt === null,
      `dispatched=${afterCancel.dispatched}`,
    );

    // ---- Suppression (unsubscribe / bounce) ------------------------------------------
    const suppressedEmail = `${ROW_PREFIX}-${runId}-suppressed@example.com`;
    const suppressed = await prisma.reviewRequest.create({
      data: {
        storeId: store.id,
        productId: product.id,
        email: suppressedEmail,
        name: "Suppressed Customer",
        delayDays: 0,
        status: "sent",
        sentAt,
        requestToken: randomUUID(),
      },
    });

    await prisma.emailSuppression.create({
      data: { storeId: store.id, email: suppressedEmail.toLowerCase(), source: "unsubscribe_link" },
    });

    const beforeSuppressionCount = LIVE ? 0 : getCapturedEmails().length;
    const afterSuppression = await runDueReminderSweep(finalClock);
    const suppressedRow = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: suppressed.id } });

    check(
      "a suppressed recipient receives no reminder and is not claimed",
      afterSuppression.dispatched === 0 && suppressedRow.reminder1SentAt === null,
      `dispatched=${afterSuppression.dispatched}`,
    );
    if (!LIVE) {
      check("no email was produced for the suppressed recipient", getCapturedEmails().length === beforeSuppressionCount);
    }

    // ---- Summary ---------------------------------------------------------------------
    const failed = checks.filter((entry) => !entry.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
    if (failed.length > 0) {
      console.log("Failed:");
      for (const entry of failed) {
        console.log(`  - ${entry.label}${entry.detail ? ` (${entry.detail})` : ""}`);
      }
    }
    if (LIVE) {
      console.log(`\nCheck ${AUTHORISED_LIVE_RECIPIENT} for three emails: initial, reminder 1, final reminder.`);
      console.log("Verify in the client: sender name, Reply-To, rendered content, and the review link.");
    }

    process.exitCode = failed.length === 0 ? 0 : 1;
  } finally {
    // Deletes only what this run created. Store cascade removes its products, requests and
    // suppressions; nothing outside this store is touched.
    if (storeId) {
      await prisma.store.delete({ where: { id: storeId } }).catch((error: unknown) => {
        console.error(`  cleanup failed for store ${storeId} — remove it by hand:`, error);
      });
      console.log(`  cleanup: removed test store ${slug}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
