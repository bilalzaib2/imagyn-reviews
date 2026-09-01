import prisma from "../db.server";
import { enqueueReminderDispatch, enqueueReviewRequestDispatch } from "./reviewRequestDispatch.server";
import type { ReminderType } from "./review-request.server";
import { emailSuppressionService } from "./emailSuppression.server";

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

// One pass: finds every request still "scheduled" whose scheduledFor has arrived, across every
// store — dispatchRequestEmail needs no Shopify Admin session (only Prisma + the email
// provider), so this sweep is deliberately store-agnostic rather than looped per shop. Returns
// counts instead of throwing: enqueueReviewRequestDispatch's own dispatch path already never
// throws on a send failure (the row lands on "failed", visible in the admin UI) — the try/catch
// below only guards against something genuinely unexpected (e.g. a DB blip), so one bad row can
// never abort the rest of the sweep.
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

// One pass: finds every non-terminal, unreviewed ReviewRequest belonging to a store with
// reminders enabled that still has at least one un-sent reminder, then applies each store's own
// configured reminder1DelayDays/reminderFinalDelayDays (Settings → Request Scheduling) against
// that request's sentAt. The day-based cutoff can't live in the Prisma `where` below — it's
// merchant-configurable per store now, not a fixed constant, and Prisma can't compare a row's
// own column against a value pulled from its *related* row in a single query — so it's computed
// in JS per row instead, same pattern already used for the remindersEnabledAt guard just below
// it. `due` counts every row whose date-based condition is actually met (regardless of whether
// the remindersEnabledAt/suppression guards go on to block it) — that's what the historical-
// safety and suppression tests below rely on to distinguish "was due" from "was sent". At most
// one reminder is dispatched per row per tick (reminder1 takes priority if both happen to be due
// at once, e.g. after extended downtime) — the other becomes eligible on the very next tick.
export async function runDueReminderSweep(now: Date = new Date()): Promise<{ due: number; dispatched: number }> {
  const candidates = await prisma.reviewRequest.findMany({
    where: {
      reviewedAt: null,
      status: { notIn: ["completed", "cancelled", "failed"] },
      sentAt: { not: null },
      store: { reminderEmailsEnabled: true },
      OR: [{ reminder1SentAt: null }, { reminderFinalSentAt: null }],
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

  let due = 0;
  let dispatched = 0;

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

    if (!reminderType) {
      continue;
    }

    due += 1;

    if (!request.store.remindersEnabledAt || request.sentAt < request.store.remindersEnabledAt) {
      continue;
    }

    // Same cross-table-comparison limitation as the remindersEnabledAt guard above — checked in
    // JS rather than the Prisma `where`. Skipped without setting reminder1SentAt/
    // reminderFinalSentAt (dispatchReminderEmail would no-op on this anyway, but checking here
    // too keeps `dispatched` an accurate count of emails actually sent, and avoids an
    // unnecessary dispatch-layer round trip for a row every sweep already knows is suppressed).
    if (await emailSuppressionService.isSuppressed(request.store.id, request.email)) {
      continue;
    }

    try {
      await enqueueReminderDispatch(request.id, reminderType);
      dispatched += 1;
    } catch (error) {
      console.error(`[reviewRequestScheduler] Failed to dispatch ${reminderType} for request ${request.id}:`, error);
    }
  }

  return { due, dispatched };
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

  const runAllSweeps = () => {
    runDueReviewRequestSweep().catch((error) => {
      console.error("[reviewRequestScheduler] Sweep failed:", error);
    });
    runDueReminderSweep().catch((error) => {
      console.error("[reviewRequestScheduler] Reminder sweep failed:", error);
    });
  };

  setInterval(runAllSweeps, SWEEP_INTERVAL_MS);

  // Also run one pass shortly after boot rather than waiting a full interval for the first
  // pass — catches anything that became due while the process was down for a deploy.
  setTimeout(runAllSweeps, 10_000);
}
