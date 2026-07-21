import { dispatchRequestEmail, reviewRequestService } from "./review-request.server";

// The single seam between "a review request is due to send" and "the email actually goes
// out." Today this runs inline, synchronously — there is no scheduler yet, so nothing calls
// this for a *scheduled* request once its scheduledFor date arrives (immediate, delayDays===0
// requests still dispatch at creation time via review-request.server.ts directly). When a real
// queue (BullMQ, Cloud Tasks, Railway Cron, a scheduled worker) is introduced, only this
// function's body changes — to enqueue { requestId } instead of sending inline — and no caller
// (webhook handlers, admin actions, a future scheduler) needs to change, because the contract
// is already "give me a requestId, I'll make sure the email goes out."
export async function enqueueReviewRequestDispatch(requestId: string): Promise<void> {
  const request = await reviewRequestService.getRequest(requestId);

  if (!request) {
    return;
  }

  await dispatchRequestEmail(request);
}
