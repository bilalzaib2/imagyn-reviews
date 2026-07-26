# CHANGELOG.md

Notable changes to Imagyn Reviews, newest first. Commit SHAs refer to `main`.

---

## 2026-07-26

### Added

- **Brand Studio wired to the live storefront.** Most of the wiring already existed (Card
  Style, Border Radius on review cards, Accent Color on stars) — this closed the remaining
  gap: the real "Submit review" button now reflects Button Style (Filled/Outline/Ghost) and
  Border Radius instead of only the Widget Builder's older per-widget color; the widget's
  base font-size (the em-anchor every internal spacing gap scales from) now reflects
  Typography Scale. Nothing in the older per-widget `WidgetSettings`/Widget Builder
  "Appearance" tab was changed or removed — it still works exactly as before for every
  property Brand Studio doesn't claim. See [DECISIONS.md](./DECISIONS.md).

- **Brand Studio UX polish pass.** The page (still at `/app/appearance`) and nav item are
  now branded "Brand Studio" throughout the UI. Every color field is a native swatch + hex
  pair — no field ever shows a merchant raw `rgba(...)` — while transparent, theme-adaptive
  defaults (Border, Empty Star) keep their real resolved value until a merchant actually
  edits them. Border Radius and Text Size use a shared, Apple-Settings-style slider with a
  large persistent value label instead of a small floating bubble. Controls are grouped
  into Style / Typography / Colors / Layout, matching how a merchant thinks about the page
  rather than the token schema underneath it. The live preview now shows three sample
  reviews with a Verified Buyer tag and an overall-rating quickbar, using real CSS classes
  that were already shipped but unused (no new components). See
  [DECISIONS.md](./DECISIONS.md).

- **Appearance page rebuilt into the Brand Studio foundation.** The four Widget Style
  presets (Minimal, Modern, Editorial, Luxury) went from inert "Coming soon" placeholders
  to real, selectable token bundles; Border Radius became a single 0–24px slider (was a
  3-way sharp/soft/round select); Accent Color got a native color-picker swatch plus a live
  star-color preview; Button Style (Filled/Outline/Ghost) and Typography's font-family seam
  are now wired into the resolver; a new Card Appearance section (Background, Border, Shadow
  intensity) is exposed once a merchant chooses "Boxed card" for Review Cards. Everything
  saves through the existing per-store `Appearance` table (no migration — tokens are stored
  as JSON) and renders in the same instant, real-CSS/JS live preview the page already had.
  See [DECISIONS.md](./DECISIONS.md) for the full list of token/naming changes and why each
  one is non-breaking for existing stores.

- **Import/Export Reviews (V1)** — merchant migration support, added to the Reviews page
  header. CSV import goes through a new `Importer` provider abstraction
  (`app/services/importers/`, mirroring the AI/Storage/Notification/Billing pattern) so
  Judge.me/Loox/Stamped/Ryviu can be added later as a new file plus one factory case, with no
  UI redesign. The merchant sees an instant client-side preview of the first rows before
  committing; the single "Import" click both validates and creates rows in one round trip
  (`app/services/reviewImportExport.server.ts`) — no temp storage, no two-phase commit.
  Per-row failures (unknown product, out-of-range rating, missing content) are reported with
  their original CSV row number rather than aborting the whole file; exact-match duplicates
  (`storeId` + `productId` + `reviewerName` + `content`) are skipped, not re-imported. Imported
  rows auto-publish by default (already vetted on their source platform) unless a `status`
  column says otherwise, still bounded by the Starter plan's published-review cap — a row that
  would exceed it is created `pending` instead of being dropped. Export streams every review to
  CSV using the same column schema import accepts, so a merchant's own export can be
  re-imported unchanged. No schema changes.

- **Mandatory GDPR compliance webhooks** (`customers/data_request`, `customers/redact`,
  `shop/redact`) — required for every public Shopify app, independent of billing. Implemented
  as a single `app/routes/webhooks.compliance.tsx`, not three separate routes: Shopify requires
  all three `compliance_topics` on one subscription block sharing one `uri` (confirmed by a
  real deployment rejection — "The following topic is invalid" — when first registered as
  ordinary per-topic `[[webhooks.subscriptions]]` blocks with individual URIs); the handler
  dispatches on the `topic` string the SDK already extracts (`CUSTOMERS_DATA_REQUEST`,
  `CUSTOMERS_REDACT`, `SHOP_REDACT`). `customers/data_request` logs a full audit record
  (matching `Review`/`ReviewRequest` rows) for the merchant to fulfill Shopify's 30-day
  disclosure window manually; no automated export pipeline was built (out of scope for a
  minimal implementation). `customers/redact` nulls the customer's identifying fields
  (`reviewerEmail`/`reviewerName`, `ReviewRequest.email`/`name`) while keeping the review
  content itself, which belongs to the merchant's storefront, not the customer. `shop/redact`
  reuses the existing `deleteStore()` — every model already cascades from `Store`, so one
  delete is a complete, correct erasure. Same HMAC verification every other webhook already
  gets from the SDK via `authenticate.webhook`, no separate security work needed. No schema
  changes.

- **Shopify Billing** — three-tier subscription (Starter free, Growth $9.99/mo, Pro
  $29.99/mo, both paid tiers with a 14-day free trial), built on Shopify's official Billing
  API (`shopifyApp({ billing: {...} })` + `authenticate.admin().billing`), not a third-party
  or off-platform billing system.
  - `app/services/billing/plans.ts` — single source of truth for plan pricing, trial length,
    and feature entitlements; both the pricing page and every feature gate read from here.
  - `app/services/billing/billing.server.ts` — plan selection, upgrade/downgrade (via
    `replacementBehavior: ApplyImmediately`, no manual cancel+recreate step), cancellation,
    live reconciliation with Shopify (`syncBillingFromShopify`), and development-store
    detection (`shop.plan.partnerDevelopment`, cached on `Store.isDevelopmentStore` after the
    first check).
  - `app/routes/app.billing.tsx` — the pricing/plan-selection page merchants land on both
    voluntarily (via the new "Billing" nav item) and involuntarily (the access gate below).
  - `app/routes/webhooks.app_subscriptions.update.tsx` — keeps `Store.plan`/`planStatus` in
    sync when a subscription changes outside the app (trial ending, payment declined,
    cancellation from Shopify's own subscription screen).
  - **Centralized access control**: `app/routes/app.tsx`'s root loader (parent of every
    `/app/*` route) redirects to `/app/billing` whenever a store has no active plan/trial and
    isn't a development store — one gate, not scattered per-route checks. The billing page
    itself, and everything outside `/app/*` (OAuth, webhooks), is exempt by construction.
  - **Centralized feature gating**, enforced at the points that already exist (no new product
    features were built to justify the tiers): the Starter plan's 50-published-review cap
    (`review.server.ts`, both single and bulk approve), AI summaries (`aiSummary.server.ts`),
    photo reviews (`reviewMedia.server.ts`, shared by the storefront widget and the review-link
    page), and automatic review requests (`webhooks.fulfillments.create.tsx` /
    `app.settings.tsx`, alongside the existing Protected-Customer-Data gate). Entitlements
    listed on the pricing page that have no corresponding app feature yet (video reviews,
    multiple email templates, advanced branding controls, priority support, future API access)
    are recorded in `plans.ts` but intentionally not enforced anywhere — see
    [DECISIONS.md](./DECISIONS.md).
  - `Store.plan` / `planStatus` / `shopifySubscriptionId` / `trialEndsAt` /
    `isDevelopmentStore` — migration `20260726082648_add_billing`, additive only, applied to
    production (verified: no errors, all new columns present, existing row unaffected).
  - New webhook subscription `app_subscriptions/update` added to `shopify.app.toml` — no new
    OAuth scope required.

## 2026-07-22

### Added

- **Completed the public review-link customer journey** (`app/routes/r.$token.tsx`) — the
  token-secured page now shows the product's featured image, and customers can attach up to
  `MAX_IMAGES_PER_REVIEW` photos to their submission using the same storage pipeline the
  storefront widget uses (`uploadReviewImages`). Since this route has no live Shopify session
  (reached by a public emailed link, not an embedded request), photo uploads use
  `shopify.server.ts`'s `unauthenticated.admin(shop)` — the SDK's documented mechanism for
  Admin API access outside a Shopify-originated request — resolved via the store's
  `domain`, now selected alongside every `ReviewRequest` query
  (`review-request.server.ts`'s new shared `REQUEST_INCLUDE` constant, replacing 12 duplicated
  `include` blocks with one). Photo upload is best-effort: a storage/Admin API failure never
  loses the review itself, only surfaces a warning on the thank-you screen. Extracted the
  multipart file-parsing helper (`readImageFilesFromFormData`) out of `api.reviews.tsx` into
  `reviewMedia.server.ts` so both the storefront widget and the review-link page share one
  implementation. Token validation (not-found/expired/already-used) and completion marking
  were already built; this pass adds the product image and photo upload, and the whole flow
  (email → review page → database → merchant dashboard) was verified end-to-end in production.
  See [DECISIONS.md](./DECISIONS.md).

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
