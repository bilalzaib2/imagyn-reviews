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
-   **Shopify Billing** — Starter (free) / Growth ($9.99/mo), 14-day trial on the paid tier,
    official Shopify Billing API, development-store bypass, centralized access gate
    (`app.tsx`) and feature gating (`services/billing/`), verified end-to-end in production
    (subscription creation, trial, upgrade/downgrade, cancellation, webhook sync). Pro was
    removed from the merchant-facing pricing page during the V1 launch-readiness pass — its
    plan definition/Shopify billing config are untouched so it can return once it has real
    exclusive functionality. See [DECISIONS.md](./DECISIONS.md).
-   **Mandatory GDPR compliance webhooks** (`customers/data_request`, `customers/redact`,
    `shop/redact`) — required for App Store approval independent of billing.
-   **Import/Export Reviews (V1)** — CSV import with an extensible importer-provider
    abstraction (Judge.me/Loox/Stamped/Ryviu placeholders ready for later), client-side
    preview of the first rows, per-row validation with row-numbered error messages, duplicate
    detection, and plan-limit-aware auto-approval. CSV export of all reviews using the same
    column schema, for round-trip re-import. See [DECISIONS.md](./DECISIONS.md).

## Blocked

-   **Order-triggered auto-creation** (`fulfillments/create` webhook) — built and gated behind
    `ORDER_AUTOMATION_ENABLED = false` (`app/config/features.ts`). Shopify rejected the webhook
    subscription: "not approved to subscribe to webhook topics containing protected customer
    data." Requires completing Shopify's Protected Customer Data approval before the
    webhook/scope can be added back to `shopify.app.toml` and the flag flipped. See
    [DECISIONS.md](./DECISIONS.md).

## Next

1.  Shopify Protected Customer Data approval → unblock order-triggered auto-creation
2.  Confirm manual/legacy Billing API is still selectable in the Partner Dashboard submission
    flow for this (not yet published) app
3.  App Store listing assets (screenshots, demo store, listing copy, privacy policy)
4.  Resend inbound webhook (populates `delivered` / `opened` statuses)
5.  Brand Studio V2 — AI Brand Match, URL analysis, AI suggestions, widget preset
    marketplace (explicitly deferred; V1 foundation above is data-ready for this)
6.  Public Review Pages
7.  Reintroduce a Pro tier once it has real, exclusive functionality (see DECISIONS.md's
    "V1 launch truthfulness pass")
