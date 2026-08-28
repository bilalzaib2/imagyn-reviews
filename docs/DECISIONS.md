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
    Appearance page's iframe preview, because the boxed/flat card treatment and button
    style are both purely CSS-variable-driven on the same classes reviews-widget.js already
    renders in production, not a class only the preview fixture would add or remove.

## Brand Studio UX polish pass (2026-07-26)

-   **Renamed "Appearance" to "Brand Studio" in user-facing text only** (nav label, page
    title) — the route path (`/app/appearance`), file names, and every internal
    identifier (`appearanceService`, `AppearanceTokens`, `app.appearance.module.css`, ...)
    are unchanged. Renaming the URL too would need a redirect for zero real benefit; the
    internal names are accurate technical descriptions of what the system does
    (design-token appearance state), independent of what the page is branded as today.
-   **Color fields never show a merchant raw `rgba(...)`, without changing any default's
    real resolved value.** Border and Empty Star both default to a transparent black
    overlay (`rgba(0,0,0,0.08)` / `0.15`) specifically so they adapt to *any* theme
    background — a flat hex can't do that, so changing the underlying default would be a
    real regression for every store that never touches these fields. Instead, a small
    `toDisplayHex()` helper (`app.appearance.tsx`, admin-UI-only, not part of the token
    contract) approximates the overlay as a flat hex over white purely for the swatch/text
    field's display value. The stored token is only ever rewritten once a merchant actually
    edits the field — at which point it becomes a real, fixed hex, the same tradeoff Accent
    Color already made with its own non-transparent default.
-   **Border Radius and Text Size use a shared `ValueSlider` pattern** (label + a large,
    persistent numeric value beside it, not Polaris `RangeSlider`'s small floating output
    bubble) — closer to an Apple Settings row than a raw dev control. Text Size is
    displayed as a percentage (`105%`) rather than the raw `1.05` multiplier stored in
    `typography.scale`; the stored value and its resolver are unchanged, only the label.
-   **The four named groups (Style / Typography / Colors / Layout) are a presentation-only
    grouping of the existing Sections**, not a new data structure — `AppearanceTokens`'
    categories don't map 1:1 to the four groups (e.g. Text Color lives in `colors` but is
    grouped under Typography, matching how a merchant thinks about it) and don't need to.
    "Advanced" (max content width, motion, reserved star/image notes) is kept, ungrouped,
    at the bottom — present per "never remove existing functionality," not surfaced as a
    fifth named group since the request didn't ask for one.
-   **The live preview now shows three sample reviews, an overall-rating quickbar, and a
    Verified Buyer tag**, using the summary/tag CSS classes that were already shipped but
    unused in production (`imagyn-component-summary.css`'s quickbar, the reserved
    `.imagyn-tag`/`.imagyn-pill` primitives) — the same "real CSS, not yet wired into a
    production block" status Button Style already had. `imagyn-utilities.css` and
    `imagyn-component-tag.css` were added to `copy-preview-assets.mjs`'s file list so the
    preview iframe can load them; no new CSS was authored.

## Brand Studio → live storefront wiring (2026-07-26)

-   **Most of this was already wired before this pass** — `ImagynAppearance.apply(data.
    appearance)` (the real, DB-resolved tokens, via `getStorefrontAppearance`) was already
    called on every real storefront page load in all three blocks (`star_rating.liquid`,
    `rating_badge.liquid`, `collection_rating_badges.liquid` all already load
    `imagyn-appearance.js` and their JS already calls `.apply()`). Card Style
    (flat/spacing/boxed), Border Radius on `.imagyn-review-card`, and Accent Color on the
    Summary/Badge stars (`.imagyn-summary__quickbar-stars`, `.imagyn-card-badge__stars`)
    were already real — confirmed by reading the shipped code, not assumed. The actual gap
    was narrower: two elements plus one anchor property that still read *only* the older,
    per-widget-instance `WidgetSettings` variable family (`--imagyn-button-color`,
    `--imagyn-border-radius`, `--imagyn-body-font-size` — set by `reviews-widget.js`'s
    `applyStyle()`, sourced from the Widget Builder's own separate "Appearance" tab, not
    Brand Studio).
-   **Fixed, specifically:** `.imagyn-reviews__submit` (the real review-form submit button)
    now reads `--imagyn-btn-background` / `--imagyn-btn-color` / `--imagyn-btn-border-color`
    (Button Style) and `--imagyn-radius-md` (Border Radius); `.imagyn-reviews__load-more`
    reads `--imagyn-radius-md`; `.imagyn-reviews`'s own base `font-size` reads
    `--imagyn-font-size-base` (Typography Scale) — this last one matters beyond text size,
    since it's the em-anchor every `--imagyn-space-*` gap inside the widget scales from.
    Each is a `var(--new-name, var(--old-name, static-fallback))` chain: because old and new
    are genuinely different property names (not the same property re-cascaded), redirecting
    which name a rule reads is enough — no precedence trick needed, and nothing in the old
    `applyStyle()`/Widget Builder code was touched, so it keeps working exactly as before for
    every property Brand Studio doesn't claim.
-   **Deliberately left alone:** `.imagyn-summary__quickbar-write` (the "Write a review"
    quickbar trigger) was already fully on Brand Studio tokens (font size, color, border,
    spacing, motion) — it just doesn't participate in Button Style's Filled/Outline/Ghost
    switch, by the same pre-existing, explicitly documented restraint choice as before
    ("a quiet outline pill, not a filled button... restrained to match"). Per-review star
    color (`.imagyn-review-card__stars`) stays monochrome for the same pre-existing,
    documented reason (§16 — the accent stays reserved for the Summary/Badge, not repeated
    down the whole list). Neither is a gap; both are prior, intentional design decisions
    this pass didn't reopen.
-   **Widget Style presets need no additional wiring of their own** — a preset is just a
    bundle of the same categories (typography, spacing, corners, borders, buttons,
    reviewCards, cards) already resolved above, so once each category's real storefront
    consumer was fixed, presets render correctly by construction.

## Apple Polish Sprint — storefront review widget (2026-07-26)

-   **The native file input is hidden via opacity, not `display: none`/`visibility:
    hidden`.** It's absolutely positioned to cover the entire custom dropzone
    (`.imagyn-upload`) and stays the actual thing that receives click/keyboard/focus —
    Tab reaches it, Enter/Space opens the OS file picker, screen readers announce it via
    `aria-labelledby`/`aria-describedby` pointing at the visible label/hint text. This is
    the standard, most robust pattern for a custom-styled file input specifically because
    it costs nothing in accessibility versus a from-scratch ARIA widget.
-   **Drag-and-drop reads `DataTransfer.files` directly on the wrapper's `drop` event**,
    not by forwarding the drop onto the (invisible but present) native input — simpler, and
    means the exact same `addFiles()` validation function (extracted from the old inline
    `change` handler) runs regardless of whether a file arrived by click or by drop, so
    there's exactly one place that enforces the type/size/count limits.
-   **The drag-over accent border/tint uses `--imagyn-color-star`** (Brand Studio's Accent
    Color), not a hardcoded blue — a merchant's configured brand color shows up the moment
    they're about to drop a file in, a small but deliberate tie-back to the Brand Studio
    work earlier this session. The focus ring still uses `--imagyn-color-focus` (unrelated
    to brand color, matching every other focus ring in the system).
-   **`color-mix()`** is used for the drag-over tint and the input focus ring's soft glow
    (`color-mix(in srgb, var(--imagyn-color-focus) 15%, transparent)`) rather than a second
    hardcoded rgba per color — assumed safe for a 2026 storefront-visitor browser base
    (broadly supported in evergreen browsers); if unsupported, the property is simply
    ignored (no tint/glow), not a crash.
-   **New `--imagyn-color-danger` token** (`#c0392b`, imagyn-tokens.css) joins the existing
    `--imagyn-color-success` — purely a tokenization of a color that was already hardcoded
    in `.imagyn-reviews__form-error`, not a new merchant-facing setting.
-   **A `--uploading` thumbnail modifier class exists in CSS but is never toggled by any
    JS** — reserved for a future real per-file upload-progress indicator, matching this
    codebase's established "reserved category" precedent (buttons/stars/images tokens
    elsewhere) rather than wiring a fake progress state that doesn't reflect anything real
    (photos currently upload as one batch at submit time, not per-file).
-   **Scope held to the write-review form and its immediate surroundings** (Load More,
    Sort) — the Review Card, Summary, and Badge components were already on the fully
    tokenized, polished system from earlier Appearance System work and needed no changes
    here.

## V1 launch truthfulness pass (2026-07-27)

-   **Pro tier removed from the merchant-facing pricing page.** Audited every advertised
    Growth/Pro feature against the actual code (`grep` for each `PlanLimits` flag's
    consumers, not assumption): `videoReviews`, `multipleEmailTemplates`,
    `advancedBranding`, `prioritySupport` are checked nowhere outside `plans.ts` itself —
    zero enforcement, zero UI, in some cases (video, support) zero underlying mechanism of
    any kind. Once every unusable claim is removed, Pro has no differentiator left over
    Growth ("Everything in Growth" and nothing else true) — not a defensible paid tier.
    `getAllPlans()` (`billing.server.ts`) now returns only Starter/Growth; `PlanId`, the
    `pro` entry in `PLANS`, and `shopify.server.ts`'s Shopify billing config are
    **unchanged** — a real Pro tier can return later by adding real functionality and
    un-hiding it from `getAllPlans()`, no re-architecture needed.
-   **Growth's own feature list had two more of the same problem, fixed rather than just
    Pro's:** "Advanced widget customization" was removed outright — Brand Studio is
    available to every plan including free Starter, so it was never actually a Growth
    differentiator. "Email customization" was renamed to "Branded review request emails" —
    there is no customization UI of any kind (one fixed template, for every merchant), but
    the underlying claim of a real, working, store-branded automated email is true and
    worth stating accurately instead of removing entirely.
-   **"Automatic review requests" stays on Growth's list, with an honest qualifier
    ("activating after Shopify's pending approval")** rather than being removed — this is
    the one claim that's real, fully built, and tested, just blocked by Shopify's own
    external Protected Customer Data approval (`ORDER_AUTOMATION_ENABLED = false`), not by
    incompleteness on this app's side. Settings already discloses this same status; the
    pricing page now matches instead of overclaiming.
-   **Engineering cleanup done alongside the truthfulness pass** (per the same sprint):
    consolidated three copy-pasted skeleton-shimmer blocks and three copy-pasted
    empty/error-state panels (Reviews/Requests/Widgets admin pages) into
    `app/styles/shared.module.css` via CSS Modules `composes`; replaced hardcoded
    rgba duplicates of `--color-danger`/`--color-success` with `color-mix()` against the
    real tokens; added `--color-info` (a color two files already shared with no token) and
    `--radius-full` (used ~15 times as a literal `999px`) to `design-system.css`; removed a
    duplicate `.installBadge` rule; deduplicated `renderStars()` across
    `reviews-widget.js`/`rating-badge.js`/`collection-rating-badges.js` into
    `window.ImagynShared` on `imagyn-appearance.js` (already loaded on all three blocks,
    so no new script tag); converted all three blocks' parser-blocking `script_tag` script
    includes to `defer` (theme-check had flagged this repeatedly) — relative order between
    `imagyn-appearance.js` and each widget's own script is preserved because deferred
    scripts execute in source order.
-   **Investigated but did not change:** the "8 admin stylesheets have no `@media` query"
    finding from the prior QA report. On inspection, the two layouts that actually
    mattered (Dashboard's stat grid, Billing's plan grid) both already use
    `repeat(auto-fit, minmax(...))`, which reflows without needing an explicit breakpoint —
    adding one would have been unnecessary defensive CSS for a problem that doesn't exist.

## Permissions architecture, Scale tier, Owner plan, and the Judge.me importer rewrite (2026-08-07)

-   **`app/services/permissions.ts` replaces `PlanLimits`/`assertPlanFeature`/`PlanLimitError`
    in `billing/billing.server.ts` as the one place gating decisions are made.** Every call
    site that used to read `getPlanLimits(plan).someFlag` now reads
    `(await getStorePermissions(storeId)).someFlag` — `plans.ts` is display metadata only
    now (price, trial length, marketing copy), permissions.ts is the only file that maps a
    `PlanId` to what a store can actually do. No call site outside permissions.ts branches
    on a plan name string. Rewired: `app.settings.tsx`, `webhooks.fulfillments.create.tsx`,
    `aiSummary.server.ts`, `reviewMedia.server.ts`, `review.server.ts` (published-review
    cap), and newly, `app.appearance.tsx` (Brand Studio, previously ungated on every plan).
-   **`PlanId` gained `"scale"` (renamed from `"pro"`) and `"owner"`.** Owner is a real,
    storable `Store.plan` value — not a `shop` allowlist, not a separate boolean flag next
    to `isDevelopmentStore` — so it works through the exact same `getPermissions()` lookup
    every other plan does (`OWNER` entry: every flag `true`, `maxPublishedReviews: null`).
    `plans.ts`'s `PLAN_ORDER` (and therefore `getAllPlans()`) deliberately excludes
    `"owner"` — it can never render on the pricing page, and `syncBillingFromShopify` now
    short-circuits immediately for a store already on `"owner"`, so a billing-page visit or
    an `app_subscriptions/update` webhook can never reconcile it back down to Starter (it
    has no Shopify subscription to find, and would otherwise fall into the same "no active
    subscription → Starter" branch every real cancelled store does).
    `getBillingSnapshot().hasAccess` also treats `plan === "owner"` as automatic access, the
    same way `isDevelopmentStore` already did. **Turning a specific Store row into Owner is
    a manual, one-time DB write (`UPDATE "Store" SET plan = 'owner' WHERE ...`) that still
    goes through this repo's normal database-safety checklist — it was intentionally not
    executed as part of this change.**
-   **Truthfulness pass extended, not reversed, when Scale (formerly Pro) was asked to list
    Video Reviews / White Label / Custom Email Domain / SMTP / API Access / Webhooks /
    Unlimited Team Members** — none of these exist in the codebase, same category of gap the
    2026-07-27 pass above removed from Pro's list entirely. This time the resolution is
    per-feature "Coming soon" tagging (`PlanFeature.comingSoon` in `plans.ts`, mirrored in
    the website's `pricing/page.tsx`) rather than deletion: the entitlement is real in
    `permissions.ts` (a Scale store already has `canUseVideoReviews`, etc. `true`, so the
    feature activates for every existing Scale subscriber the moment it ships, no plan-data
    migration), but nothing claims the feature is usable *today*. Also re-flagged two
    Growth claims that don't hold up under the same audit: "Automatic review requests" and
    "Automatic email reminders" are both still blocked by `ORDER_AUTOMATION_ENABLED = false`
    (Shopify Protected Customer Data approval, unchanged since the July pass) — both now
    carry `comingSoon: true` everywhere they're listed. "Advanced analytics" is also tagged
    `comingSoon` — the dashboard's Trust Overview/Rating Distribution exist for every plan
    already and aren't a Growth-exclusive "advanced" feature.
-   **Judge.me CSV import root cause:** `reviewImportExport.server.ts`'s old
    `resolveProductId()` only ever matched a single loosely-typed `product` string against
    `Product.handle` or `Product.name` by exact string equality — it never read
    `Product.shopifyProductId` (stored in GID form) at all. Judge.me's export puts Shopify's
    bare numeric product id in a `product_id` column; that value never had anywhere to go,
    so every row fell through to "Product not found" regardless of how clean the export
    was. Fixed by `app/services/importers/productMatcher.server.ts` (`ProductMatcher`),
    which loads a store's product catalog once per import and matches each row through the
    requested priority chain: Shopify Product ID → Variant ID (live Admin API lookup,
    cached per import run — no local variant table exists) → Handle → URL (handle
    extracted from a `/products/<handle>` path) → Slug → SKU (live Admin API lookup, same
    caching) → exact title → normalized title (accent/punctuation-insensitive) → fuzzy
    title (token-overlap, 0.75 similarity floor, last resort). `ParsedReviewRow` gained the
    structured identifier fields (`productId`, `variantId`, `productHandle`, `productUrl`,
    `productSlug`, `sku`) needed to feed it; `csv.server.ts`'s alias table and the new
    `judgeme.server.ts` both populate them, sharing one parsing core
    (`delimitedParser.server.ts`) rather than duplicating header-matching logic. A fuzzy
    match is reported back as a `warnings` entry (not silently accepted) so a merchant can
    spot-check it. `importReviews()` now takes an optional `AdminApiContext` — required
    only for the two live-lookup tiers — and never aborts a batch on one row's failure,
    matching the existing `importReviews` convention. `ImportResult` gained
    `missingProducts`/`warnings` as buckets distinct from `errors` (hard validation
    failures), each with a per-row, specific reason rather than a generic message.
-   **Not done, and deliberately out of scope for this pass:** photo-URL import from
    Judge.me's `pictures` column (would need a re-hosting decision through the storage
    provider, not just a new parsed field — see `reviewMedia.server.ts`), and a
    Loox/Stamped/Ryviu/Ali Reviews parser (Loox's export is JSON, not CSV, so it can't reuse
    `delimitedParser.server.ts` the way Judge.me does — it needs its own `Importer`
    implementation). Both are additive: neither requires touching `ProductMatcher`,
    `provider.server.ts`'s factory shape, or anything already shipped here.

## One-Click Branding: Brand Match removed, no reliable Shopify detection source exists (2026-08-25)

-   **Root cause:** `brandMatch.server.ts` queried `shop { brand { colors { primary { ... } }
    logo { image { url } } } } }` on the Admin GraphQL API, expecting to read a merchant's
    brand color/logo directly from Shopify. Confirmed via live schema introspection (Admin
    API 2026-07) that **`Shop.brand` does not exist** — the query always threw
    `GraphqlQueryError: Field 'brand' doesn't exist on type 'Shop'`, silently caught, and
    always degraded to the empty state. Brand Match never worked, for any merchant, at any
    point — its own unit tests never caught this because they mock `admin.graphql()`
    directly rather than validating against Shopify's real schema.
-   **Investigated and ruled out:** (1) No other `Shop` field exposes brand color/logo — the
    full field list was inspected directly, nothing else is a candidate. (2) `read_themes` +
    reading a theme's `settings_data.json` `Asset` could surface *a* color a merchant set in
    their theme customizer, but the app holds no `read_themes` scope today (see
    `widgetInstallDetection.server.ts` — same conclusion reached independently for widget
    install detection), and even with the scope, extraction isn't reliable/universal: every
    theme's settings schema is different, so this would be a guess dressed up as detection —
    exactly what this feature must not do. Not adding the scope; not implementing this path.
    (3) Scraping the live storefront's rendered HTML/CSS (the technique
    `widgetInstallDetection.server.ts` legitimately uses for known DOM markers) does not
    generalize to "infer this arbitrary theme's brand color" — valid for a yes/no marker
    check, not for color/typography extraction.
-   **Decision:** `brandMatch.server.ts` and its tests were deleted outright (nothing to
    "fix" — the field it depends on doesn't exist). One-Click Branding's primary action
    (`app.appearance.tsx`'s "Apply to email templates" / the `applyEmailBranding` action
    intent) now sources from the merchant's own already-saved Imagyn brand settings (Accent
    Color + Logo, the same fields the manual Colors/Branding sections below it write to) and
    pushes them into all three email templates (`emailTemplateService
    .applyBrandingToAllTemplates`, unchanged). This keeps the one-button action fully
    functional without any invented or unreliable Shopify API, and without a fake
    "detected" state.
