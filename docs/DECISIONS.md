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

## Import/Export Reviews V1 (2026-07-26)

-   **Importer provider abstraction, same pattern as AI/Storage/Notifications/Billing.**
    `app/services/importers/types.ts` defines the `Importer` interface (`parse(fileContent)`);
    `provider.server.ts`'s `getImporter(source)` is the one factory switch. CSV is the only
    real implementation; Judge.me/Loox/Stamped/Ryviu are listed in `IMPORT_SOURCES` as
    `available: false` placeholders so the picker UI never needs to change shape when they're
    wired up — only a new `createXImporter()` file and one new `case`.
-   **`IMPORT_SOURCES` lives in `types.ts`, not `provider.server.ts`**, despite being importer
    metadata — the Reviews page's "Import from" selector needs it client-side, and any
    `*.server.ts` module is excluded from the client bundle by convention. Splitting pure data
    (safe on both sides) from the factory function (server-only, imports `csv.server.ts`)
    keeps the existing `.server.ts` boundary convention intact.
-   **CSV import is a single round-trip, not a stateful two-phase preview/commit.** The first
    few rows are parsed and previewed entirely client-side (the same `papaparse` library,
    already a dependency for the server-side parser) before the merchant clicks Import; the
    one server round-trip both validates and commits. Avoids needing temporary file storage or
    a session-scoped "pending import" record for a V1 feature.
-   **A CSV row's `status` column controls auto-approval, defaulting to approved.** Reviews
    arriving via import were already vetted on whatever platform exported them, so — unlike a
    customer's own submission, which always starts `pending` — an import row publishes
    immediately unless its `status` column explicitly says `pending`/`rejected`. Auto-approval
    still respects the Starter plan's published-review cap (`createReview`'s new
    `autoApprove` flag checks the same `getPlanLimits`/`getStorePlanId` helpers
    `setReviewStatus` already used); a row that would exceed the cap is created as `pending`
    instead of being rejected outright, so an import never silently drops data.
-   **Duplicate detection is exact-match on `(storeId, productId, reviewerName, content)`**,
    not fuzzy matching — simple, predictable, and sufficient for the stated goal ("prevent
    duplicate imports where possible") without a scoring/threshold system to tune or explain.
-   **Export reuses the same column schema import accepts**, so a merchant's exported CSV can
    be re-imported (into this store or another) without edits — one shared header contract for
    both directions.

## Appearance System → Brand Studio foundation (2026-07-26)

-   **The four "Widget Style" presets are now real**, not inert placeholders. Each is a
    `Partial<AppearanceTokens>` covering only *structural* categories (typography scale,
    spacing density, corners, borders, buttons, review-card treatment, card shadow) —
    deliberately never `colors`. `mergeAppearanceTokens` gained an optional `base` parameter
    (defaults to `getDefaultAppearanceTokens()`, but the Appearance page passes the current
    draft) specifically so selecting a preset layers structure on top of whatever Accent
    Color the merchant already has, rather than overwriting it. "Editorial" reproduces
    `getDefaultAppearanceTokens()` exactly, so it's both the fifth preset and the un-styled
    baseline. `"classic"` was renamed to `"luxury"` (a pre-launch, single-dev-store rename —
    `appearance.server.ts`'s `normalizePreset` falls back any unrecognized stored value to
    `"custom"`, so no migration or data loss).
-   **Border Radius became one literal 0–24px slider**, replacing the three-way
    `"sharp"|"soft"|"round"` categorical select. The slider's value IS
    `--imagyn-radius-md`; `--imagyn-radius-{sm,lg}` derive proportionally (0.5x / 1.5x) in
    `imagyn-appearance.js`. Default 8 reproduces today's static radii exactly. Any
    previously-saved `corners.radiusScale` value is simply absent from the new shape —
    `mergeAppearanceTokens`'s shallow merge means it's ignored, not a crash, and the store
    silently gets the (visually identical, for the un-customized "soft" case) new default.
-   **Review Card separator gained a third value, `"boxed"`**, alongside the existing
    `"border"`/`"spacing"` (STOREFRONT_DESIGN_SYSTEM.md §16's "pick one, never both" pair).
    "Boxed" is what makes the new **Card Appearance** section's Background/Border/Shadow
    controls visible — Background and Border reuse the existing `colors.surfaceColor` /
    `colors.borderColor` + `borders.width` tokens (already global), so the only genuinely
    new token is `cards.shadowIntensity`. Implemented entirely through CSS custom
    properties on the existing `.imagyn-review-card` rule (`--imagyn-review-card-{border-
    width,padding,background,radius,shadow}`, set by `imagyn-appearance.js`'s
    `applyReviewCards`) — no new CSS class, no `reviews-widget.js` changes. Flat mode
    (`"border"`/`"spacing"`) resolves to the exact same static values the old hardcoded CSS
    used, so this is additive: existing live stores render pixel-identically unless a
    merchant actively opts into "Boxed card."
-   **Button Style (Filled/Outline/Ghost) is now wired**, but only into the reserved
    `.imagyn-btn` primitive (`imagyn-component-button.css`) — the same "stored, shown in the
    admin preview, not yet wired into any currently-shipped button" status this control
    already had, just with a real, working implementation behind it instead of nothing.
    `reviews-widget.css`'s actual production buttons are untouched, per "don't redesign
    existing widgets."
-   **Typography gained a reserved `fontFamily: string | null` field**, wired end-to-end in
    `imagyn-appearance.js` (applies `--imagyn-font-family` the moment it's non-null) but not
    yet exposed as a picker in the admin UI — the requested "prepare architecture for future
    custom fonts" seam, matching the existing stars/images reserved-category pattern.
-   **Spacing's `"comfortable"` value was renamed to `"balanced"`** to match the requested
    Compact/Balanced/Spacious naming exactly. Same zero-migration reasoning as the preset
    rename above (JSON-string-encoded `tokens` column, shallow-merge fallback to new
    defaults for any old stored value).
-   **The live preview and the real storefront share one CSS/JS code path with no
    divergence** — Card Appearance, Border Radius, and Button Style are all visible in the
    Appearance page's iframe preview using the exact same fixture markup as before (no
    changes to `appearance-preview.tsx` were needed), because the boxed/flat card treatment
    and button style are both purely CSS-variable-driven on the *same* classes the fixture
    already renders, not a class the fixture would need to add or remove.
