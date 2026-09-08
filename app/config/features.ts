// Shopify's Protected Customer Data review for this app — the external approval order-
// lifecycle automation has always been blocked on. GRANTED 2026-09-08 (Partner Dashboard:
// "Protected customer data access — Approved", Name + Email fields). This constant tracks
// that external fact only; it does NOT turn automation on by itself — see
// ORDER_AUTOMATION_ENABLED below, which is a separate, deliberate activation switch.
export const SHOPIFY_PROTECTED_CUSTOMER_DATA_APPROVED = true;

// Order-lifecycle automation (auto-creating Review Requests from Shopify orders) depends on
// the `fulfillments/create` webhook, whose payload (destination address, customer email) is
// protected customer data. Shopify's approval for that data (see
// SHOPIFY_PROTECTED_CUSTOMER_DATA_APPROVED above) is now granted, but this flag is
// deliberately still false: turning it on requires restoring the `fulfillments/create`
// webhook subscription + `read_fulfillments` scope in shopify.app.toml and running
// `shopify app deploy` — the moment every live merchant's real customers start receiving
// automatic emails, with no undo. That's a deliberate go-live decision, not an automatic
// consequence of Shopify's approval landing. Everything upstream of the actual webhook
// trigger (schema, service layer, retry logic, admin UI) is built, tested, and shipped —
// see docs/DECISIONS.md.
export const ORDER_AUTOMATION_ENABLED = false;
