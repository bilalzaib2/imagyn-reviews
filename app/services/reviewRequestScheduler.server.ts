import prisma from "../db.server";
import { enqueueReviewRequestDispatch } from "./reviewRequestDispatch.server";

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

  setInterval(() => {
    runDueReviewRequestSweep().catch((error) => {
      console.error("[reviewRequestScheduler] Sweep failed:", error);
    });
  }, SWEEP_INTERVAL_MS);

  // Also run one sweep shortly after boot rather than waiting a full interval for the first
  // pass — catches anything that became due while the process was down for a deploy.
  setTimeout(() => {
    runDueReviewRequestSweep().catch((error) => {
      console.error("[reviewRequestScheduler] Initial sweep failed:", error);
    });
  }, 10_000);
}
