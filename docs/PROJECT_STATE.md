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
-   Appearance System (storefront design tokens)
-   **Shopify Billing** — Starter (free) / Growth ($9.99/mo) / Pro ($29.99/mo), 14-day trial on
    paid tiers, official Shopify Billing API, development-store bypass, centralized access
    gate (`app.tsx`) and feature gating (`services/billing/`). See
    [DECISIONS.md](./DECISIONS.md).

## Blocked

-   **Order-triggered auto-creation** (`fulfillments/create` webhook) — built and gated behind
    `ORDER_AUTOMATION_ENABLED = false` (`app/config/features.ts`). Shopify rejected the webhook
    subscription: "not approved to subscribe to webhook topics containing protected customer
    data." Requires completing Shopify's Protected Customer Data approval before the
    webhook/scope can be added back to `shopify.app.toml` and the flag flipped. See
    [DECISIONS.md](./DECISIONS.md).

## Next

1.  Shopify Protected Customer Data approval → unblock order-triggered auto-creation
2.  Resend inbound webhook (populates `delivered` / `opened` statuses)
3.  App Store listing assets (screenshots, demo store, listing copy)
4.  Widget Customization
5.  Public Review Pages
