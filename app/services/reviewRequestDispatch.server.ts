import { dispatchReminderEmail, dispatchRequestEmail, reviewRequestService, type ReminderType } from "./review-request.server";

// The single seam between "a review request is due to send" and "the email actually goes
// out." Runs inline, synchronously, dispatched by reviewRequestScheduler.server.ts's periodic
// sweep (immediate, delayDays===0 requests still dispatch at creation time via
// review-request.server.ts directly). When a real queue (BullMQ, Cloud Tasks, Railway Cron, a
// scheduled worker) is introduced, only this function's body changes — to enqueue { requestId }
// instead of sending inline — and no caller (webhook handlers, admin actions, the scheduler)
// needs to change, because the contract is already "give me a requestId, I'll make sure the
// email goes out."
export async function enqueueReviewRequestDispatch(requestId: string): Promise<void> {
  const request = await reviewRequestService.getRequest(requestId);

  if (!request) {
    return;
  }

  await dispatchRequestEmail(request);
}

// Same seam, for Automatic Reminder Emails (see reviewRequestScheduler.server.ts's
// runDueReminderSweep) — kept as its own function rather than a parameter on
// enqueueReviewRequestDispatch, since a reminder dispatch and the original Day-0 dispatch have
// different eligibility rules and never share a call site.
export async function enqueueReminderDispatch(requestId: string, reminderType: ReminderType): Promise<void> {
  const request = await reviewRequestService.getRequest(requestId);

  if (!request) {
    return;
  }

  await dispatchReminderEmail(request, reminderType);
}
