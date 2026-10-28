import prisma from "../db.server";
import { enqueueReminderDispatch, enqueueReviewRequestDispatch } from "./reviewRequestDispatch.server";
import { reviewRequestService, type ReminderType } from "./review-request.server";
import { emailSuppressionService } from "./emailSuppression.server";
import { getStorePermissions } from "./permissions";

// This process (react-router-serve) stays alive on Railway between requests — the same
// assumption productSync.server.ts's fire-and-forget catalog sync already relies on — so a
// plain in-process setInterval is enough to actually deliver the "scheduled" half of the
// review-request lifecycle that review-request.server.ts/reviewRequestDispatch.server.ts
// already built the seam for. No external cron/queue infrastructure needed for the MVP; if a
// real queue (BullMQ, Cloud Tasks, Railway Cron) is introduced later, only startReviewRequestScheduler
// changes — runDueReviewRequestSweep's contract (find due rows, dispatch each) stays the same.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// Caps how many due requests a single sweep dispatches, so one large backlog (e.g. after
// downtime) can't monopolize a tick or burst-hammer the email provider — whatever's left over
// is still "scheduled" and gets picked up by the next tick.
const SWEEP_BATCH_SIZE = 25;

// How long a claimed-but-undelivered row may sit before another sweep may reclaim it.
//
// A claim is "status: scheduled -> sending" taken before the send. That is what makes two
// workers safe, but it introduces one failure mode the old select-then-send did not have: if the
// process dies between the claim and the send's own terminal write, the row is left on "sending"
// with nothing scheduled to finish it. Under the previous code that row would have stayed
// "scheduled" and simply been retried next tick, so leaving it stranded would be a regression in
// delivery, not just in tidiness.
//
// Three sweep intervals, deliberately generous. A real send finishes in seconds, and
// dispatchRequestEmail refreshes updatedAt on every attempt (it writes sendAttempts each time),
// so an in-progress retry sequence keeps extending its own lease. Nothing legitimate is still
// working after 15 minutes.
//
// NOTE: this also recovers rows stranded by the pre-existing path — reviewRequestService's
// resendRequest/createRequest set "sending" before dispatching too, so a crash there has always
// been able to strand a row. Those were previously stuck forever; they now rejoin the schedule.
const STALE_CLAIM_MS = 3 * SWEEP_INTERVAL_MS;

/**
 * Returns claimed rows to "scheduled" so a later sweep can retry them.
 *
 * Matches on updatedAt rather than a new column: Prisma maintains it via @updatedAt on every
 * write, so the claim itself timestamps the lease and no migration is needed. `status` is
 * indexed (@@index([status]) on ReviewRequest), so this stays cheap.
 */
export async function recoverStaleClaims(now: Date = new Date()): Promise<{ recovered: number }> {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);

  const result = await prisma.reviewRequest.updateMany({
    where: { status: "sending", updatedAt: { lt: cutoff } },
    data: { status: "scheduled" },
  });

  if (result.count > 0) {
    console.log(`[reviewRequestScheduler] recovered ${result.count} stale claim(s) back to scheduled`);
  }

  return { recovered: result.count };
}

// One pass: finds every request still "scheduled" whose scheduledFor has arrived, across every
// store — dispatchRequestEmail needs no Shopify Admin session (only Prisma + the email
// provider), so this sweep is deliberately store-agnostic rather than looped per shop. Returns
// counts instead of throwing: enqueueReviewRequestDispatch's own dispatch path already never
// throws on a send failure (the row lands on "failed", visible in the admin UI) — the try/catch
// below only guards against something genuinely unexpected (e.g. a DB blip), so one bad row can
// never abort the rest of the sweep.
//
// CONCURRENCY: the findMany below is only a candidate list. Selecting a row grants no right to
// send it — every row must be claimed with the conditional update inside the loop, and only the
// worker whose update reports count === 1 proceeds. Without that, two Railway replicas (or two
// overlapping ticks in one process) both select the same "scheduled" rows and both send, because
// the terminal "sent"/"failed" write happens after the email leaves. `status` is the lock: the
// database serialises the transition out of "scheduled", so exactly one claimant can win.
export async function runDueReviewRequestSweep(now: Date = new Date()): Promise<{ due: number; dispatched: number }> {
  const due = await prisma.reviewRequest.findMany({
    where: { status: "scheduled", scheduledFor: { lte: now } },
    select: { id: true },
    orderBy: { scheduledFor: "asc" },
    take: SWEEP_BATCH_SIZE,
  });

  let dispatched = 0;

  for (const request of due) {
    try {
      // The claim. "sending" is the existing in-flight status (resendRequest already uses it),
      // so this introduces no new state and nothing downstream needs teaching about it —
      // dispatchRequestEmail overwrites it with "sent" or "failed" either way.
      const claim = await prisma.reviewRequest.updateMany({
        where: { id: request.id, status: "scheduled" },
        data: { status: "sending" },
      });

      // Lost the race, or the row stopped being eligible between select and claim (cancelled
      // from the admin, completed by the customer). Either way another party owns it now.
      if (claim.count !== 1) {
        continue;
      }

      await enqueueReviewRequestDispatch(request.id);
      dispatched += 1;
    } catch (error) {
      console.error(`[reviewRequestScheduler] Failed to dispatch review request ${request.id}:`, error);
    }
  }

  return { due: due.length, dispatched };
}

function daysBefore(now: Date, days: number): Date {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

// Plan entitlement for automated reminders, resolved once per store per sweep rather than
// once per candidate row — a single store can easily own every row in a batch, and
// getStorePermissions is a real database read.
//
// Why this exists at all: Store.reminderEmailsEnabled is a merchant *preference*, not an
// entitlement. Settings → Request Scheduling refuses to turn it on without
// canUseEmailReminders, but nothing ever turns it back off when a store leaves Pro — a
// downgrade (or a cancelled/expired Shopify subscription, which syncBillingFromShopify
// collapses to plan "starter") leaves the stored preference `true` forever. Without this
// check, that store would keep receiving the Pro-only Day-N reminder sequence on Free.
// Checked here, in the one place reminders are actually dispatched, rather than by
// rewriting the merchant's saved preference on downgrade: the preference is theirs, and it
// must come back intact the moment they upgrade again.
async function canUseRemindersCached(storeId: string, cache: Map<string, boolean>): Promise<boolean> {
  const cached = cache.get(storeId);
  if (cached !== undefined) {
    return cached;
  }

  const permissions = await getStorePermissions(storeId);
  cache.set(storeId, permissions.canUseEmailReminders);
  return permissions.canUseEmailReminders;
}

// One pass: finds every ReviewRequest that is genuinely ready for one of its two reminders, and
// dispatches it. At most one reminder per row per tick (reminder1 takes priority if both happen
// to be due at once, e.g. after extended downtime) — the other becomes eligible on the next tick.
//
// WHAT `due` MEANS: actionable reminders — rows eligible for dispatch on this tick. It is NOT a
// backlog size and must never be read as one. A row that cannot produce an email is excluded by
// the candidate query and never counted: a request predating its store's remindersEnabledAt, a
// suppressed or redacted recipient, a store without the plan entitlement, or a row not yet past
// its store's configured delay. `due` minus `dispatched` is therefore real failure — a send that
// errored or a claim lost to another worker — not routine filtering, which is what makes the
// heartbeat's `reminders due=N sent=M` worth alerting on.
//
// REACHABILITY — why those exclusions live in SQL rather than in the loop below. Every one of
// them used to be a JS guard applied after the fetch, and every one `continue`s before the claim,
// so a blocked row was never stamped and stayed a candidate forever. Ordered oldest-first under
// `take: SWEEP_BATCH_SIZE`, a large enough set of permanently-blocked rows filled every slot and
// nothing newer was ever reached. Production hit exactly this: a heartbeat reading
// `reminders due=25 sent=0` against a 182-row backlog, with the batch size at 25.
//
// The store list is therefore loaded first, which turns each store's own remindersEnabledAt,
// delay days and plan entitlement into *values* — a cross-row column comparison Prisma cannot
// express in a single query, which is why these checks were in JS to begin with. The plan check
// in particular must happen here and not per row: the batch is merged and sliced ACROSS stores,
// so a downgraded store's permanently-stuck rows would otherwise starve paying stores too.
//
// The JS guards below are kept as backstops, so loosening the `where` cannot start emailing
// someone it should not. Each exclusion has a PROOF test pinning the starvation it prevents.
export async function runDueReminderSweep(
  now: Date = new Date(),
): Promise<{ due: number; dispatched: number; claimLeaks: number }> {
  // remindersEnabledAt: null is excluded here for the same reason the JS guard rejected it — a
  // store that has never switched reminders on has no eligible request at all.
  const stores = await prisma.store.findMany({
    where: { reminderEmailsEnabled: true, remindersEnabledAt: { not: null } },
    select: { id: true, remindersEnabledAt: true, reminder1DelayDays: true, reminderFinalDelayDays: true },
  });

  // One bounded query per store — the list is only stores with reminders switched on, and each
  // query is scoped to that store's own rows, its own cutoff and its own delays, so no store can
  // ever see another's. The results are merged and re-sorted into the single oldest-first batch
  // this sweep has always processed, then trimmed to the same shared SWEEP_BATCH_SIZE budget:
  // ordering and per-sweep dispatch cost are unchanged.
  //
  // Every exclusion below exists for one reason: a row that cannot produce an email must not
  // occupy a slot. Each of these guards used to run in JS, after the fetch, and each `continue`s
  // before the claim — so the row was never stamped, stayed a candidate, and under oldest-first
  // ordering with a fixed `take` a large enough set of them starved everything newer. Each is
  // proven by its own PROOF test in reviewRequestScheduler.server.test.ts.
  const reminderEntitlementByStore = new Map<string, boolean>();

  const perStore = await Promise.all(
    stores.map(async (store) => {
      // Plan entitlement, resolved before this store's rows are fetched at all. Free never
      // receives an automated reminder sequence (only the single initial request, dispatched by
      // runDueReviewRequestSweep entirely independently of this sweep) — see
      // canUseRemindersCached for why a stale-true preference outlives a downgrade.
      //
      // Checked HERE rather than per row because the batch is merged and sliced ACROSS stores:
      // a downgraded store's rows stay timing-due forever, and fetching them hands that store a
      // share of a shared budget it can never use — starving PAYING stores, not just itself.
      if (!(await canUseRemindersCached(store.id, reminderEntitlementByStore))) {
        return [];
      }

      // The store's own delays, as values — which is what lets the timing test live in SQL. A row
      // that has had reminder_1 but is not yet due for reminder_final is the case this closes:
      // it matched the old unconditioned OR, dispatched nothing, and at production's 3/7 delays a
      // store sending ~7 requests a day fills the whole band with them.
      const reminder1Cutoff = daysBefore(now, store.reminder1DelayDays);
      const reminderFinalCutoff = daysBefore(now, store.reminderFinalDelayDays);

      // Suppressed recipients never leave the candidate set on their own — unsubscribes only
      // accumulate — so this is the one vector that grows without bound.
      const suppressedEmails = await emailSuppressionService.listSuppressedEmails(store.id);

      return prisma.reviewRequest.findMany({
        where: {
          storeId: store.id,
          reviewedAt: null,
          status: { notIn: ["completed", "cancelled", "failed"] },
          sentAt: { not: null, gte: store.remindersEnabledAt as Date },
          // `not: null` first, and not merely for tidiness: email is nullable (retention redacts
          // it at 90 days), a reminder to no address can never be sent, and in SQL `NULL NOT IN
          // (...)` is NULL — so without the explicit null check, `notIn` would silently drop
          // these rows anyway while leaving the no-suppressions case including them.
          email: suppressedEmails.length > 0 ? { not: null, notIn: suppressedEmails } : { not: null },
          OR: [
            { reminder1SentAt: null, sentAt: { lte: reminder1Cutoff } },
            { reminderFinalSentAt: null, sentAt: { lte: reminderFinalCutoff } },
          ],
        },
        select: {
          id: true,
          email: true,
          sentAt: true,
          reminder1SentAt: true,
          reminderFinalSentAt: true,
          store: {
            select: { id: true, remindersEnabledAt: true, reminder1DelayDays: true, reminderFinalDelayDays: true },
          },
        },
        orderBy: { sentAt: "asc" },
        take: SWEEP_BATCH_SIZE,
      });
    }),
  );

  const candidates = perStore
    .flat()
    .sort((a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0))
    .slice(0, SWEEP_BATCH_SIZE);

  let due = 0;
  let dispatched = 0;
  // Claims taken but neither sent nor released — each one is a reminder silently consumed.
  let claimLeaks = 0;

  for (const request of candidates) {
    if (!request.sentAt) {
      continue;
    }

    const reminder1Cutoff = daysBefore(now, request.store.reminder1DelayDays);
    const reminderFinalCutoff = daysBefore(now, request.store.reminderFinalDelayDays);

    let reminderType: ReminderType | null = null;
    if (!request.reminder1SentAt && request.sentAt <= reminder1Cutoff) {
      reminderType = "reminder_1";
    } else if (!request.reminderFinalSentAt && request.sentAt <= reminderFinalCutoff) {
      reminderType = "reminder_final";
    }

    // Backstop: the candidate query's OR now carries each store's own delay cutoffs, so every
    // fetched row is genuinely due for one of the two reminders. Kept so that the timing rule is
    // still enforced in one place if that `where` is ever loosened.
    if (!reminderType) {
      continue;
    }

    due += 1;

    // Plan gate, checked before the store's own preference guards below: Free never receives
    // an automated reminder sequence, only the single initial request (which is a Free
    // capability and is dispatched by runDueReviewRequestSweep above, entirely independently
    // of this sweep). See canUseRemindersCached for why a stale-true preference is possible.
    if (!(await canUseRemindersCached(request.store.id, reminderEntitlementByStore))) {
      continue;
    }

    // Backstop only: the candidate query above already excludes these rows, per store, which is
    // what keeps the batch reachable. Kept because this is the guard that must never regress — if
    // a later change loosens that `where`, a historical request still cannot be emailed.
    if (!request.store.remindersEnabledAt || request.sentAt < request.store.remindersEnabledAt) {
      continue;
    }

    // Backstop, for the same reason as the guard above — the candidate query already excluded
    // this store's suppressed addresses. It is still a real check, not dead code: the SQL
    // exclusion matches on the stored address, and EmailSuppression normalises to lower case
    // while ReviewRequest.email is only trimmed, so an address stored with different casing
    // survives the `notIn` and is caught here instead. Such a row does still hold a slot, but
    // one needs 25 of them to starve a batch, which no realistic casing mix produces. Skipped
    // without setting reminder1SentAt/
    // reminderFinalSentAt (dispatchReminderEmail would no-op on this anyway, but checking here
    // too keeps `dispatched` an accurate count of emails actually sent, and avoids an
    // unnecessary dispatch-layer round trip for a row every sweep already knows is suppressed).
    if (await emailSuppressionService.isSuppressed(request.store.id, request.email)) {
      continue;
    }

    // The claim, same principle as the Day-0 sweep but on the reminder's own field rather than
    // `status` — a reminder must never touch status (see dispatchReminderEmail's header). The
    // field flips null -> timestamp here, BEFORE the send, so the database serialises it and only
    // one worker can win. Previously the field was written after the send, which is why two
    // replicas could both pass the `null` check and both email the same customer.
    const field = REMINDER_CLAIM_FIELD[reminderType];
    const claim = await prisma.reviewRequest.updateMany({
      where: { id: request.id, [field]: null },
      data: { [field]: now },
    });

    if (claim.count !== 1) {
      continue;
    }

    try {
      const sent = await enqueueReminderDispatch(request.id, reminderType);

      if (sent) {
        dispatched += 1;
      } else {
        // Roll the claim back so the row is eligible again next tick. This is what preserves the
        // pre-existing retry-by-next-tick behaviour under a pre-send claim: without it, a send
        // that failed (provider error, suppression discovered at dispatch time) would leave the
        // field stamped and the reminder would never be sent at all.
        if (!(await releaseReminderClaim(request.id, field)).released) {
          claimLeaks += 1;
        }
      }
    } catch (error) {
      console.error(`[reviewRequestScheduler] Failed to dispatch ${reminderType} for request ${request.id}:`, error);
      // Same rollback on an unexpected throw — a claim must never outlive the attempt it was
      // taken for.
      if (!(await releaseReminderClaim(request.id, field)).released) {
        claimLeaks += 1;
      }
    }
  }

  return { due, dispatched, claimLeaks };
}

const REMINDER_CLAIM_FIELD: Record<ReminderType, "reminder1SentAt" | "reminderFinalSentAt"> = {
  reminder_1: "reminder1SentAt",
  reminder_final: "reminderFinalSentAt",
};

// Undoes a reminder claim. No guard on the row still being terminal-free is needed — the only
// writers of these fields are the claim above and dispatchReminderEmail's own confirmation
// write, and we only reach here when no send happened.
//
// Never throws: a rollback failure must not abort the rest of the sweep, and it can only ever
// degrade to "this one reminder is skipped", never to a duplicate email. That is the safe
// direction, but it IS a silent loss, so the failure is counted and surfaced rather than only
// logged — see SchedulerRunSummary.reminderClaimLeaks and getSchedulerStatus, which the admin's
// automation status already reads. A non-zero count means a reminder was consumed without being
// sent, and the affected row needs a manual resend.
async function releaseReminderClaim(
  requestId: string,
  field: "reminder1SentAt" | "reminderFinalSentAt",
): Promise<{ released: boolean }> {
  try {
    await prisma.reviewRequest.updateMany({
      where: { id: requestId },
      data: { [field]: null },
    });
    return { released: true };
  } catch (error) {
    // Deliberately loud: this is the one path in the whole sweep that can lose a reminder.
    console.error(
      `[reviewRequestScheduler] LEAKED CLAIM — failed to release ${field} on ${requestId}; ` +
        `this reminder will not be retried and needs a manual resend:`,
      error,
    );
    return { released: false };
  }
}

// Data-retention purge (see docs/DATA_RETENTION_POLICY.md) — 90 days, a real business
// decision made 2026-09-08, not an engineering default. Redacts ReviewRequest.email/name on
// terminal (completed/failed/cancelled) requests older than this; never touches Review
// content, never touches a still-live request that could still become a real review. See
// reviewRequestService.purgeStaleContactInfo's own header comment for the full scoping rules
// this delegates to.
const RETENTION_DAYS = 90;

// One pass: purges stale ReviewRequest contact info across every store. Deliberately loops
// per-store rather than a single cross-store query — reuses
// reviewRequestService.purgeStaleContactInfo as the single source of truth for what "stale"
// means and what gets touched (already independently tested, including its own audit-log
// call), instead of re-deriving that query and its redaction/audit logic a second time here.
// A store count in the low tens (this app's actual scale) makes one findMany-per-store call
// per 5-minute tick negligible — revisit the loop-vs-single-query tradeoff if that stops
// holding. One store's failure never aborts the rest, same isolation convention as the two
// sweeps above.
export async function runRetentionPurgeSweep(now: Date = new Date()): Promise<{ storesProcessed: number; redacted: number }> {
  const stores = await prisma.store.findMany({ select: { id: true } });

  let redacted = 0;

  for (const store of stores) {
    try {
      const result = await reviewRequestService.purgeStaleContactInfo(store.id, { retentionDays: RETENTION_DAYS, now });
      redacted += result.redacted;
    } catch (error) {
      console.error(`[reviewRequestScheduler] Retention purge failed for store ${store.id}:`, error);
    }
  }

  return { storesProcessed: stores.length, redacted };
}

export interface SchedulerRunSummary {
  startedAt: Date;
  /** Rows returned from a stranded "sending" claim to "scheduled" this tick. */
  recovery: { recovered: number } | null;
  requests: { due: number; dispatched: number } | null;
  reminders: { due: number; dispatched: number; claimLeaks: number } | null;
  retention: { storesProcessed: number; redacted: number } | null;
  /** Which sweeps threw. Empty on a fully successful pass. */
  errors: string[];
}

// How many consecutive do-nothing sweeps pass before a heartbeat is logged anyway, so an
// idle but healthy scheduler still proves it is alive. 12 x 5min = hourly.
const IDLE_TICKS_PER_HEARTBEAT = 12;

let lastRun: SchedulerRunSummary | null = null;
let idleTicks = 0;

/**
 * The last completed sweep, for operator/merchant-facing status ("last successful run").
 *
 * In-process and therefore reset by a deploy — which is honest: after a restart there
 * genuinely has not been a run yet in this process, and the boot pass fills it within
 * seconds. Nothing schedules off this value; it is observability only.
 */
export function getSchedulerStatus(): {
  running: boolean;
  intervalMinutes: number;
  lastRun: SchedulerRunSummary | null;
} {
  return {
    running: global.reviewRequestSchedulerStarted === true,
    intervalMinutes: SWEEP_INTERVAL_MS / 60000,
    lastRun,
  };
}

declare global {
  // eslint-disable-next-line no-var
  var reviewRequestSchedulerStarted: boolean | undefined;
}

// Starts the periodic sweep exactly once per process — guarded via globalThis the same way
// db.server.ts guards its dev-mode Prisma singleton, so Vite's dev-server HMR (which
// re-evaluates this module on every file change) can never register a second interval. Called
// once, at module scope, from entry.server.tsx — never from a route/loader, since those run
// per-request.
export function startReviewRequestScheduler(): void {
  if (global.reviewRequestSchedulerStarted) {
    return;
  }
  global.reviewRequestSchedulerStarted = true;

  const runAllSweeps = async () => {
    const startedAt = new Date();
    const status: SchedulerRunSummary = {
      startedAt,
      recovery: null,
      requests: null,
      reminders: null,
      retention: null,
      errors: [],
    };

    // Recovery runs FIRST, before the request sweep, so a row stranded on "sending" by a crashed
    // worker is back on "scheduled" in time for this same tick to pick it up — rather than
    // waiting a further interval. Its own try/catch for the same reason as the sweeps below: a
    // recovery failure must not stop mail going out.
    try {
      status.recovery = await recoverStaleClaims();
    } catch (error) {
      status.errors.push("recovery");
      console.error("[reviewRequestScheduler] Stale-claim recovery failed:", error);
    }

    // Each sweep is awaited and recorded separately so one failing sweep neither hides nor
    // aborts the other two — a retention error must not stop reminders going out.
    try {
      status.requests = await runDueReviewRequestSweep();
    } catch (error) {
      status.errors.push("requests");
      console.error("[reviewRequestScheduler] Sweep failed:", error);
    }
    try {
      status.reminders = await runDueReminderSweep();
    } catch (error) {
      status.errors.push("reminders");
      console.error("[reviewRequestScheduler] Reminder sweep failed:", error);
    }
    try {
      status.retention = await runRetentionPurgeSweep();
    } catch (error) {
      status.errors.push("retention");
      console.error("[reviewRequestScheduler] Retention purge sweep failed:", error);
    }

    lastRun = status;

    // Observability, deliberately quiet. Before this the scheduler logged only failures, so
    // an empty log was indistinguishable from "the loop is not running at all" — there was
    // no way for an operator to confirm the automation was alive. A line is emitted when a
    // sweep actually did something, and otherwise only once an hour, so liveness is always
    // provable without 288 idle lines a day. Counts only: no email address, customer name or
    // review content ever reaches the log.
    const didWork =
      (status.recovery?.recovered ?? 0) > 0 ||
      (status.requests?.dispatched ?? 0) > 0 ||
      (status.reminders?.dispatched ?? 0) > 0 ||
      (status.reminders?.claimLeaks ?? 0) > 0 ||
      (status.retention?.redacted ?? 0) > 0 ||
      status.errors.length > 0;

    idleTicks = didWork ? 0 : idleTicks + 1;

    if (didWork || idleTicks >= IDLE_TICKS_PER_HEARTBEAT) {
      if (!didWork) idleTicks = 0;
      console.log(
        `[reviewRequestScheduler] sweep ok in ${Date.now() - startedAt.getTime()}ms — ` +
          `recovered=${status.recovery?.recovered ?? 0}; ` +
          `requests due=${status.requests?.due ?? 0} sent=${status.requests?.dispatched ?? 0}; ` +
          `reminders due=${status.reminders?.due ?? 0} sent=${status.reminders?.dispatched ?? 0}` +
          ((status.reminders?.claimLeaks ?? 0) > 0 ? ` LEAKED=${status.reminders?.claimLeaks}` : "") +
          `; ` +
          `retention stores=${status.retention?.storesProcessed ?? 0} redacted=${status.retention?.redacted ?? 0}` +
          (status.errors.length ? `; FAILED: ${status.errors.join(",")}` : ""),
      );
    }
  };

  console.log(
    `[reviewRequestScheduler] started — sweeping every ${SWEEP_INTERVAL_MS / 60000} minutes`,
  );

  setInterval(() => {
    void runAllSweeps();
  }, SWEEP_INTERVAL_MS);

  // Also run one pass shortly after boot rather than waiting a full interval for the first
  // pass — catches anything that became due while the process was down for a deploy. Due
  // work lives in the database, not in process memory, so a restart delays a send by at most
  // one interval and can never lose one.
  setTimeout(() => {
    void runAllSweeps();
  }, 10_000);
}
