import type { ActionFunctionArgs } from "react-router";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { PLANS, type PlanId } from "../services/billing/plans";
import {
  SupportRequestError,
  assertWithinRateLimit,
  getShopContactEmail,
  sendSupportRequest,
  validateSupportRequest,
} from "../services/supportRequest.server";

import type { SupportActionData } from "../services/supportRequest.shared";

// Action-only resource route (no default export) behind the app's normal admin
// authentication — the target of the in-app support form's fetcher. It exists as its own route
// rather than an action on some page because FloatingHelp renders on every /app/* screen, and
// a shared endpoint means the form works identically from all of them.
//
// Security posture:
//  - authenticateAdminDeduped throws unless the request carries a valid Shopify admin session,
//    so an unauthenticated POST can never reach the send path.
//  - Every identifying field in the email (store, shop domain, plan, merchant email) is
//    resolved here from that session, never read from the request body. The client supplies
//    only the subject, message, category and current path.
//  - The recipient is a module constant in supportRequest.server.ts and is never derived from
//    input, so this cannot be used to send mail from IMAGYN's verified domain to an arbitrary
//    address.
//  - Rate limiting is keyed on the authenticated store, not on anything client-controlled.
export const action = async ({ request }: ActionFunctionArgs): Promise<Response> => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." } satisfies SupportActionData, { status: 405 });
  }

  const { session, admin } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();

  try {
    const validated = validateSupportRequest({
      subject: String(formData.get("subject") || ""),
      message: String(formData.get("message") || ""),
      category: String(formData.get("category") || ""),
      appSection: String(formData.get("appSection") || ""),
    });

    // Checked after validation so a malformed submission doesn't consume the merchant's quota.
    assertWithinRateLimit(store.id);

    // Reply-To only. Resolved server-side, never surfaced to the merchant as an editable
    // field, and never persisted.
    const merchantEmail = await getShopContactEmail(admin);

    await sendSupportRequest({
      ...validated,
      storeId: store.id,
      storeName: store.name,
      shopDomain: session.shop,
      planName: PLANS[store.plan as PlanId]?.name ?? null,
      merchantEmail,
    });

    return Response.json({ ok: true } satisfies SupportActionData);
  } catch (error) {
    if (error instanceof SupportRequestError) {
      const status = error.kind === "validation" ? 400 : error.kind === "rate_limit" ? 429 : 502;
      return Response.json({ ok: false, error: error.message } satisfies SupportActionData, { status });
    }

    console.error("[app.support] Unexpected failure handling a support request:", error);
    return Response.json(
      { ok: false, error: "We couldn't send your request." } satisfies SupportActionData,
      { status: 500 },
    );
  }
};
