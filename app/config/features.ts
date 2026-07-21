// Order-lifecycle automation (auto-creating Review Requests from Shopify orders) depends on
// the `fulfillments/create` webhook, whose payload (destination address, customer email)
// requires Shopify's Protected Customer Data approval — not yet granted for this app (see
// docs/DECISIONS.md). Everything upstream of the actual webhook trigger (schema, service
// layer, retry logic, admin UI) is built and shipped; this is the single switch that keeps
// the trigger itself off until that approval lands and the webhook subscription + scope are
// restored to shopify.app.toml.
export const ORDER_AUTOMATION_ENABLED = false;
