# CHANGELOG.md

Notable changes to Imagyn Reviews, newest first. Commit SHAs refer to `main`.

---

## 2026-07-22

### Added

- **Real Resend email sending** for the Email Review Requests platform — the `EmailProvider`
  abstraction and `ResendProvider` (already built) now use the official `resend` SDK instead of
  a hand-rolled `fetch` call, and the review-request template is now a proper React Email
  component (`app/services/notifications/emails/ReviewRequestEmail.tsx`, rendered via
  `@react-email/render`) matching the app's monochrome, typography-first design language.
  Added a "Send Test Email" control in Settings → Email delivery, which sends a real email
  through the exact same template/provider path as a live review request
  (`sendTestReviewRequestEmail`), so Resend configuration can be verified before any customer
  ever receives one. Requires `RESEND_API_KEY` and `RESEND_FROM_EMAIL` to be set — without
  them, sending fails with a clear, existing configuration error rather than a silent no-op.
  No automatic sending, scheduling, or webhooks were added this pass — manual dispatch only.

- **Order Lifecycle Automation foundation** for the Email Review Requests platform — connects
  it to the Shopify order lifecycle. Added: `ReviewRequest.shopifyOrderId` /
  `shopifyLineItemId` / `source` / `sendAttempts` and `Store.autoRequestEnabled` /
  `autoRequestDelayDays` / `autoRequestTrigger` (migration
  `20260721172210_add_order_lifecycle_automation`, additive only, applied to production —
  verified: no errors, all new columns/indexes present, row counts unchanged before/after).
  `reviewRequestService.createFromOrder`, bounded email-send retry (`MAX_SEND_ATTEMPTS = 3`),
  a queue-readiness dispatch seam (`reviewRequestDispatch.server.ts`), a fuller
  `ReviewRequestStatus` lifecycle (`delivered`, `clicked` replacing `opened`, `completed`
  replacing `reviewed`), a lifecycle timeline + source indicator + retry count in the Requests
  admin UI, and an "Automatic review requests" section in Settings. Full rationale in
  [DECISIONS.md](./DECISIONS.md#order-lifecycle-automation-2026-07-22).
- `webhooks.fulfillments.create.tsx` — the order-triggered auto-creation handler. **Built but
  not active**: Shopify rejected the webhook subscription ("not approved to subscribe to
  webhook topics containing protected customer data") since fulfillment payloads carry
  customer email/address. Gated behind `ORDER_AUTOMATION_ENABLED = false`
  (`app/config/features.ts`) pending Shopify's Protected Customer Data approval; the
  subscription and `read_fulfillments` scope are commented out in `shopify.app.toml` rather
  than deployed. Manual review request creation is fully unaffected and live.

### Deployed

- Shopify app version `imagyn-reviews-49` created via `shopify app deploy --no-release`
  (inspected, not released as of this entry) — no new OAuth scope, no new webhook
  subscription; only the theme extension and existing config carry forward unchanged.

## 2026-07-21

### Fixed

- **Embedded app failing to load in Shopify Admin.** Root cause: a stale Shopify Dev Preview (`shopify app dev`) left the development store's embedded app URL pointed at a dead Cloudflare tunnel, independent of and unaffected by any code change, redeploy, or app version release. Fixed via `shopify app dev clean --store=verveonline.myshopify.com`. No application code changed as part of the fix. Full investigation and root cause: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#incident-2026-07-21-embedded-app-broken-after-development-work). New standing workflow rule to prevent recurrence: [SHOPIFY_DEV_WORKFLOW.md](./SHOPIFY_DEV_WORKFLOW.md#standing-rule).
- **Production database reconciliation.** Earlier the same day, `_prisma_migrations` (destroyed by an unrelated prior incident — see [`DATABASE_SAFETY.md`](../DATABASE_SAFETY.md)) was rebaselined: 6 prior migrations marked applied via `prisma migrate resolve --applied` (metadata-only, zero SQL executed, zero data touched — verified read-only before and after), then the one genuinely pending migration (`20260721010000_add_review_request_token_security`) applied via `prisma migrate deploy`. Verified: no migration remains pending, `ReviewRequest` has `tokenExpiresAt`/`tokenUsedAt`/unique index on `requestToken`, all prior application data unchanged.

### Added

- **Appearance System** (`291225f`) — a centralized, store-wide design-token system (typography, colors, spacing, layout) every storefront widget resolves against, with an admin editor, live preview, and preset architecture. Wired into the review widget, rating badge, and collection rating badges.
- **JSON-LD structured data for SEO** (`00b60f0`) — server-renders schema.org `Product`/`AggregateRating`/`Review` markup via a synced Shopify metafield (`$app.reviews_jsonld`), read directly by the storefront widget with zero extra request. Syncs automatically on review approve/reject/delete/bulk actions and on edits to already-approved reviews.
- **Email Review Requests platform** (`713d2a3`) — a channel-provider abstraction (mirrors the existing AI-provider pattern) with a Resend-backed `EmailProvider`; request creation/resend now actually dispatches email. New public, token-secured resolver route (`/r/:token`) validates expiry and single-use, renders a review-submission page, and consumes the token only after a successful review is created.

### Changed

- **Root loader revalidation** (`ff6856c`, later reverted in `115b6e2` — see below) — added, tested against live production, and removed again after it was ruled out as the cause of the same-day embedded-app incident. The underlying reasoning (the root loader's output is static and redundant with every child loader's own `authenticate.admin()` call) remains valid and may be reintroduced later, independently of this incident.
- `ReviewRequestStatus` TypeScript union corrected: `"draft"` (unused) replaced with `"pending"` (matches the actual DB default and seed data) — a pre-existing inconsistency, fixed as part of the Email Review Requests work.

### Documentation

- Added `DATABASE_SAFETY.md` (project root) — mandatory read/write checklist for any database-affecting command, written after the production data-wipe incident referenced above.
- Added `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/DESIGN_SYSTEM.md`, `docs/IMAGYN_LABS.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md` — high-level project documentation.
- Added this file, plus `docs/TROUBLESHOOTING.md`, `docs/SHOPIFY_DEV_WORKFLOW.md`, and `docs/OPERATIONS.md` — process documentation written directly out of the day's incident, so the investigation doesn't need to be repeated.

### Commits

```
291225f  feat(appearance): add centralized Appearance System for storefront widgets
00b60f0  feat(seo): add JSON-LD structured data for product reviews
ff6856c  perf(admin): skip redundant root loader revalidation on navigation
713d2a3  feat(requests): add email review request platform with token-secured public resolver
a180d8c  docs: add production database safety policy
b317d60  docs: add project architecture and roadmap notes
115b6e2  revert(admin): remove shouldRevalidate from root loader
```

Shopify app version released same day: `imagyn-reviews-48` — re-registers `application_url` to Railway production and publishes the Appearance System's storefront wiring and the JSON-LD SEO setting for the first time (previously built and admin-tested, but never live on a real storefront until this release).
