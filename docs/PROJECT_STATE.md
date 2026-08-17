# PROJECT_STATE.md

## Current Phase

App Store submission readiness (Shopify Billing shipped; hardening and polish next)

## Completed

-   Dashboard
-   Reviews
-   Requests
-   Rating badges
-   Helpful Votes
-   AI Summary
-   Photo Upload
-   Media Gallery
-   JSON-LD Rich Snippets
-   Email Review Requests (token-secured public link, Resend provider), full customer journey
    verified end-to-end in production (email → review page → database → merchant dashboard)
-   Order Lifecycle Automation — foundation (schema, service layer, bounded retry,
    queue-ready dispatch seam, admin UI: statuses, lifecycle timeline, automation settings).
    Manual review requests use this fully today.
-   **Appearance System → Brand Studio foundation** — production customization UI (Widget
    Style presets, Accent Color picker, Border Radius slider, Button Style, Typography,
    Card Appearance, Spacing), backed by the same merchant-specific, persisted token system,
    with an instant live preview rendering the real widget CSS/JS. See
    [DECISIONS.md](./DECISIONS.md).
-   **Shopify Billing** — Starter (free) / Growth ($9.99/mo) / Scale ($29.99/mo), 14-day
    trial on both paid tiers, Shopify Managed Pricing, development-store and Owner-plan
    bypass, centralized access gate (`app.tsx`) and feature gating
    (`services/permissions.ts`), verified end-to-end in production (subscription creation,
    trial, upgrade/downgrade, cancellation, webhook sync). Scale (renamed from Pro) is back
    on the merchant-facing pricing page with its full requested feature set; features with
    no enforcement point yet are tagged "Coming soon" rather than claimed as available — see
    [DECISIONS.md](./DECISIONS.md)'s 2026-08-07 entry.
-   **Centralized permission system (`app/services/permissions.ts`)** — every gate in the
    app reads a boolean off `Permissions` (`canUseAI`, `canUseBrandStudio`,
    `canUseVideoReviews`, `canUseAutomaticReviewRequests`, etc.); nothing outside this file
    branches on a plan name. Includes a hidden `"owner"` `PlanId` — every permission `true`,
    no billing, excluded from the pricing page/Shopify billing config/website/App Store —
    for internally-owned stores. See [DECISIONS.md](./DECISIONS.md).
-   **Mandatory GDPR compliance webhooks** (`customers/data_request`, `customers/redact`,
    `shop/redact`) — required for App Store approval independent of billing.
-   **Import/Export Reviews (V2)** — extensible importer-provider abstraction with a
    dedicated Judge.me parser (Loox/Stamped/Ryviu still placeholders) sharing one CSV
    parsing core, client-side preview of the first rows, and a priority-ordered product
    matcher (Shopify Product ID → Variant ID → Handle → URL → Slug → SKU → exact title →
    normalized title → fuzzy title) that replaced the old handle/name-only exact-match
    lookup responsible for Judge.me imports reporting "Product not found." Per-row import
    report now separates Missing Products / Warnings / Errors instead of one generic error
    list. CSV export includes `product_id`/`product_handle` alongside the display title, so
    a re-import always resolves at the top of the priority chain. See
    [DECISIONS.md](./DECISIONS.md).

## Blocked

-   **Order-triggered auto-creation** (`fulfillments/create` webhook) — built and gated behind
    `ORDER_AUTOMATION_ENABLED = false` (`app/config/features.ts`). Shopify rejected the webhook
    subscription: "not approved to subscribe to webhook topics containing protected customer
    data." Requires completing Shopify's Protected Customer Data approval before the
    webhook/scope can be added back to `shopify.app.toml` and the flag flipped. See
    [DECISIONS.md](./DECISIONS.md).

## Next

1.  Shopify Protected Customer Data approval → unblock order-triggered auto-creation, and
    remove the "Coming soon" tag from Automatic Review Requests / Automatic Email Reminders
    on every pricing surface once it does
2.  Shopify Partner Dashboard: rename the Managed Pricing "Pro" plan to "Scale" (this repo's
    `plans.ts`/Shopify billing config match on price already; the plan *name* Shopify shows
    at checkout is configured outside this repo and needs a manual update — same category as
    the app icon/listing assets)
3.  Manually promote specific Store rows to `plan: "owner"` for internally-owned stores
    (a one-time, explicitly-approved DB write — see DECISIONS.md's 2026-08-07 entry)
4.  App Store listing assets (screenshots, demo store, listing copy, privacy policy) —
    update pricing/feature copy entered directly in the Partner Dashboard to match the
    Starter/Growth/Scale lineup and its "Coming soon" tags once the listing text exists
5.  Resend inbound webhook (populates `delivered` / `opened` statuses)
6.  Loox (JSON export, needs its own `Importer`, not `delimitedParser.server.ts`) / Stamped /
    Ryviu / Ali Reviews importer parsers
7.  Brand Studio V2 — AI Brand Match, URL analysis, AI suggestions, widget preset
    marketplace (explicitly deferred; V1 foundation above is data-ready for this)
8.  Public Review Pages
9.  Build the Scale-tier features currently tagged "Coming soon" (video reviews, white
    label, custom email domain/SMTP, API access, webhooks, unlimited team members) —
    `permissions.ts` already grants every Scale store the entitlement; each just needs an
    enforcement point and its `comingSoon` tag removed
10. Preserve verified-review provenance on Judge.me import and show a Verified Buyer /
    Verified Review badge on the storefront for imported reviews that were originally
    verified. Discovered during the Requests UX pass (2026-08-16): reviews imported from
    Judge.me that were verified at the source currently render with no Verified badge on our
    storefront — the importer isn't capturing/mapping that flag today.
