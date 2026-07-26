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

## Shopify Billing (2026-07-26)

-   **Manual/legacy Billing API, not Shopify App Pricing.** Shopify now funnels new App Store
    submissions toward "Shopify App Pricing" (plans configured in the Partner Dashboard, no
    code) by default, with the classic Billing API (`appSubscriptionCreate` /
    `authenticate.admin().billing`) relegated to "manual pricing." This app uses the classic
    API deliberately: it's fully installed, typed, and documented in
    `@shopify/shopify-app-react-router@1.2.1`, it's explicitly still sanctioned for App Store
    distribution (not deprecated or banned), and it's the only option that lets billing logic
    live in this codebase rather than a separate dashboard configuration step. Shopify's docs
    don't describe an explicit opt-in/opt-out toggle for a not-yet-published app choosing
    manual pricing — worth confirming directly in the Partner Dashboard's submission flow
    before the actual App Store submission.
-   **A store must explicitly choose a plan, including the free one.** `Store.planStatus`
    defaults to `"pending"` (not `"active"`) — even Starter requires clicking "Select Starter"
    on the billing page. This matches the intended "Continue using Imagyn Reviews / choose a
    plan" onboarding moment rather than silently defaulting everyone into Starter.
-   **Upgrade/downgrade between paid tiers uses `replacementBehavior: ApplyImmediately`** on a
    fresh `billing.request()` call, not cancel-then-recreate — this is the Billing API's own
    documented mechanism for swapping a shop's subscription line items, and avoids a
    momentary "no active subscription" gap that a manual cancel+recreate would create.
    Downgrading to Starter (free) has no equivalent — Shopify's Billing API has no concept of
    a free subscription — so that path is `billing.cancel()` followed by a local
    `selectStarterPlan()` call.
-   **Development-store bypass is not a Billing-API feature — it's built on top of it.** The
    SDK's `isTest` flag (used for `billing.request`/`check`/`cancel`) only controls whether a
    charge is a *test* charge; it does not detect or skip billing for development stores on
    its own (confirmed by reading the SDK source, not assumed). The actual bypass is a direct
    `shop { plan { partnerDevelopment } }` GraphQL check, cached once per store on
    `Store.isDevelopmentStore`, checked in `app.tsx`'s gate before any plan/subscription logic
    runs at all.
-   **Local `Store.plan`/`planStatus` is a cache, not the source of truth** — Shopify's own
    subscription state always wins. It's kept in sync three ways: the `app_subscriptions/update`
    webhook, a live reconciliation (`syncBillingFromShopify`) every time the billing page
    loads, and the plan-selection/cancel actions writing directly. Any drift self-heals on the
    next of these three triggers.
-   **Plan entitlements that don't map to a real feature yet are intentionally unenforced.**
    The Pro tier's marketing copy (video reviews, multiple email templates, advanced branding
    controls, priority support, future API/integration features) describes commercial intent,
    not built functionality — per the explicit "no new product features for this pass"
    instruction, `plans.ts` records these as data for the pricing page and future enforcement,
    but nothing in the app currently gates on them. What *is* actually enforced: the Starter
    published-review cap, AI summaries, photo reviews, and automatic review requests — all
    features that already existed before billing was added.
