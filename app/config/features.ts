// Shopify's Protected Customer Data review for this app — the external approval order-
// lifecycle automation has always been blocked on. GRANTED 2026-09-08 (Partner Dashboard:
// "Protected customer data access — Approved", Name + Email fields). This constant tracks
// that external fact only; it does NOT turn automation on by itself — see
// ORDER_AUTOMATION_ENABLED below, which is a separate, deliberate activation switch.
export const SHOPIFY_PROTECTED_CUSTOMER_DATA_APPROVED = true;

// Order-lifecycle automation (auto-creating Review Requests from Shopify orders) depends on
// the `fulfillments/create` webhook, whose payload (destination address, customer email) is
// protected customer data. Shopify's approval for that data
// (SHOPIFY_PROTECTED_CUSTOMER_DATA_APPROVED above) was granted 2026-09-08. Activated
// 2026-09-09 after an explicit, separately-authorized go-live decision and a full re-audit
// (order eligibility, duplicate prevention via the (shopifyOrderId, productId) unique
// constraint, unsubscribe/suppression checked before every send, bounded retry, per-store
// opt-in, plan gating) plus a successful real-provider end-to-end test send. The
// `fulfillments/create` webhook subscription + `read_fulfillments` scope were restored in
// shopify.app.toml alongside this flag — see docs/DECISIONS.md.
export const ORDER_AUTOMATION_ENABLED = true;
