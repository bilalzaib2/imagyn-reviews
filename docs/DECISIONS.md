# DECISIONS.md

-   Railway hosts app.
-   imagynreviews.com = public platform.
-   app.imagynreviews.com = merchant dashboard.
-   Reviews live below product information.
-   Inline rating above product title only.

## Order Lifecycle Automation (2026-07-22)

-   One `ReviewRequest` per (order, product) line item — matches the existing multi-product
    request model. Enforced by a DB unique index on `(shopifyOrderId, productId)`; `NULL`
    `shopifyOrderId` (manual requests) is exempt, so merchants can still freely create manual
    requests for the same product.
-   Status enum extended to the full lifecycle: `pending → scheduled → sending → sent →
    delivered → opened → clicked → completed`, with `failed`/`cancelled` as terminal branches.
    `opened` (old value) was renamed to `clicked` — it's set when a customer follows the
    emailed link, not a true email-open event. `reviewed` was renamed to `completed`. Zero
    production rows existed at the time, so both renames were zero-migration-risk.
    `delivered` and true `opened` (email-open-pixel tracking) are schema/UI-ready but
    unpopulated — they require a future Resend inbound webhook.
-   Retry logic is inline and bounded (`MAX_SEND_ATTEMPTS = 3`, `sendAttempts` column), not a
    queue — matches the project's existing inline-retry precedent
    (`shopifyFiles.server.ts`'s `pollUntilReady`).
-   Queue-readiness seam: `reviewRequestDispatch.server.ts`'s `enqueueReviewRequestDispatch`
    is the one function a future queue worker (BullMQ / Cloud Tasks / Railway Cron) will
    replace the body of — no caller changes required when that lands. No worker is built yet;
    nothing currently fires when a `scheduledFor` date arrives on its own.
-   **Order-triggered auto-creation is deferred**, not removed: `webhooks.fulfillments.create.tsx`,
    the `Store.autoRequest*` settings, and the Settings UI all exist, but are gated behind
    `ORDER_AUTOMATION_ENABLED = false` (`app/config/features.ts`). Shopify rejected the
    `fulfillments/create` webhook subscription outright — "not approved to subscribe to webhook
    topics containing protected customer data" — because its payload (destination address,
    customer email) is protected customer data. This requires Shopify's Protected Customer
    Data approval (https://shopify.dev/docs/apps/launch/protected-customer-data), completed
    outside this codebase, before the webhook subscription + `read_fulfillments` scope can be
    restored to `shopify.app.toml` and the flag flipped on. Manual review request creation is
    fully unaffected.
