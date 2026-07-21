# PROJECT_STATE.md

## Current Phase

Order Lifecycle Automation (Email Review Requests, connected to Shopify orders)

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
-   Email Review Requests (token-secured public link, Resend provider)
-   Order Lifecycle Automation — foundation (schema, service layer, bounded retry,
    queue-ready dispatch seam, admin UI: statuses, lifecycle timeline, automation settings).
    Manual review requests use this fully today.
-   Appearance System (storefront design tokens)

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
3.  Billing
4.  Widget Customization
5.  Public Review Pages
