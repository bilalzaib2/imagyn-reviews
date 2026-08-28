# PROJECT_STATE.md

## Current Phase

Live in production, one real merchant on the app. Current focus: functionality hardening
before the planned premium UI/UX redesign phase (not started).

## Session Log — 2026-08-28 (Finishing Sprint, autonomous)

Working-tree state only — nothing in this session was committed or pushed.

-   **Customer-facing storefront widget — live-audited on the real storefront**
    (verveonline). Rating summary, distribution bars, AI Review Summary, Medals, Customer
    Photos, store replies, helpful-vote buttons (confirmed via a real vote, verified in the
    database, then reverted), verified-buyer badges, mobile layout (375px, no horizontal
    overflow) — all render correctly. Zero console/runtime errors. No PII exposure (only the
    store's own public contact email appears; no reviewer emails). Empty-state copy confirmed
    present in code for all three widget types. One unrelated finding: the product's own
    Shopify description text is wrong (shows a different product's copy) — merchant catalog
    data, not an app bug, not touched.
-   **"Coming to Pro" audit — one real staleness bug found and fixed.** "Video reviews" was
    labeled `comingSoon: true` in `plans.ts` even though the feature shipped and is live on
    every plan including Free (`canUseVideoReviews: true` everywhere, shipped 2026-08-24, 33
    tests, live-verified). This was a false "locked" label on a working feature — fixed the
    label and two stale comments in `permissions.ts`. The same stale label also exists on the
    separate marketing website repo (`imagyn-website/src/app/pricing/page.tsx`) — flagged,
    not touched (different repo, out of scope). Every other "Coming to Pro" item (Custom
    fonts, Star size & shape, Media gallery, widget presets, Grid/Carousel layouts, roadmap
    items, Advanced email styling, Advanced analytics, retired Scale-tier items) verified
    genuinely unbuilt, non-interactive where unbuilt, and server-enforced where gated (e.g.
    Grid/Carousel layout is force-coerced server-side for non-Pro stores in
    `widget.server.ts`, not just a UI label).
-   **Live merchant admin walkthrough** — all 11 nav areas (Dashboard, Reviews, Products,
    Requests, Email Studio, Widgets, Brand Studio, Medals, Analytics, Settings, Billing) load
    with no console errors and no error boundaries. Live-verified New Review navigation
    (PASS). Edit navigation confirmed through the click (Actions menu opens, Edit item
    clickable) — final page-load confirmation interrupted by a Cloudflare tunnel drop
    (infrastructure, not an app bug; not retried further per instruction). Found (not
    created, not touched) several leftover QA test reviews from an earlier Video Reviews
    testing session still sitting in the real reviews list — flagged for manual cleanup.
-   **Email automation** — re-verified, not rebuilt. 297/297 tests pass, including 19
    scheduler tests covering Day-0/3/7 timing, idempotency, per-store isolation, duplicate
    prevention. Confirmed OpenAI is not referenced anywhere in the send path. Outbound
    provider + actual delivery were verified live in an earlier session (real Resend webhook
    round trip reached "delivered" status) — not re-claimed as newly verified tonight.
-   **AI Summary** — regression check only, zero code changes. 11 AI tests pass; the real
    summary generated and persisted in the prior session's live verification is still intact.
-   **Production hardening** — added `.env.example` (every env var the app actually reads,
    verified by grep, not assumed; documents which are required vs. optional-with-a-default)
    and a `.gitignore` exception so it stays trackable. Spot-checked store-isolation scoping
    (achievements/medals queries) — consistent `storeId` filtering confirmed. `.env` itself
    reconfirmed gitignored and never tracked. No hardcoded secrets found. No incomplete
    migrations. Build succeeds.

**Database confirmed NOT reset/wiped/migrated tonight.** One real write occurred: a helpful
vote click during live widget testing (immediately reverted, including the denormalized
`Review.helpfulCount` counter, after explicit approval for that one correction). Every other
DB interaction was read-only. **No "Coming to Pro" feature was implemented or unlocked** —
the one label change corrected a false lock on an already-shipped feature, not a new unlock.
**Nothing was committed or pushed.**

**ROADMAP COMPLETION: ~87%.** Remaining gaps: `RESEND_WEBHOOK_SECRET`/`OPENAI_API_KEY`
production config is done; what's left is mostly the eventual premium UI/UX redesign phase
(explicitly not started, per instruction) and the Shopify Protected Customer Data approval
still pending for order-triggered auto-creation.

## Previous Session Log — 2026-08-27 (Night Shift, autonomous)

Working-tree state only — nothing in this session was committed or pushed. See git status
for the exact accumulated diff (Products/Reviews routing fixes, One-Click Branding rework,
Email Automation merchant UI, from this and prior sessions).

-   **TASK:** Reviews New/Edit routing fix (`app.reviews.$id.edit.tsx` /
    `app.reviews.new.tsx` implicitly nested under `app.reviews.tsx`, which renders no
    `<Outlet>` — identical root cause to the Products detail bug). Fixed via the same
    trailing-underscore escape-nesting rename used for Products.
    **STATUS:** Code-complete.
    **FILES CHANGED:** `app/routes/app.reviews.$id.edit.tsx` → `app.reviews_.$id.edit.tsx`,
    `app/routes/app.reviews.new.tsx` → `app.reviews_.new.tsx` (pure renames), one comment
    fix in `app/services/product.server.ts`.
    **TESTS:** typecheck clean; 297/297 pass.
    **LIVE VERIFICATION:** BLOCKED — Cloudflare quick-tunnel was unreachable across three
    consecutive `shopify app dev` attempts (unrelated to this change; the database was
    confirmed healthy via a read-only query each time). Not retried further per instruction.
    **BLOCKER:** Tunnel infrastructure only; re-attempt live verification when it's stable.

-   **TASK:** AI Review Summaries — verify existing implementation, do not rebuild.
    **STATUS:** Code-complete; blocked on credentials only.
    **FILES CHANGED:** none.
    **TESTS:** `aiSummary.server.test.ts` (3), `ai/shared.test.ts` (8) pass.
    **LIVE VERIFICATION:** Not applicable — no key to test against.
    **BLOCKER:** `OPENAI_API_KEY` not set locally or on production Railway (checked by
    variable name only; no value ever inspected). Everything else — provider abstraction,
    prompt building, strict JSON validation, DB caching, auto-regeneration threshold, the
    "Regenerate AI Summary" button already wired into the product detail page, `canUseAI`/
    Pro gating, safe failure (never fakes a summary) — is already implemented and tested.

-   **TASK:** Merchant admin audit for dead buttons/broken navigation.
    **STATUS:** Complete — no new bugs found beyond the two routing fixes already applied
    this session (Products, Reviews). Checked Dashboard, Products, Product detail, Reviews,
    Requests, Email Studio, Widgets, Branding, Analytics, Medals, Settings, Billing:
    intent/handler wiring, hardcoded Shopify admin deep-links, dead `<Button>` elements,
    orphaned action branches. Several `submitted vs. handled` intent mismatches surfaced by
    grep turned out to be false positives once the actual code was read (implicit
    fallthrough in `app.settings.tsx`; dynamic `_intent` values in `app.requests.tsx`'s
    confirmation-modal flow) — left unchanged since they already work correctly.
    **FILES CHANGED:** none.

-   **TASK:** Email automation (Day 0/3/7, suppression, idempotency, scheduler) —
    verify only, do not rebuild.
    **STATUS:** Confirmed intact. 19 scheduler tests individually confirm Day-0 dispatch,
    Day-3/Day-7 eligibility anchored to `sentAt`, idempotency (never re-sends, double-sweep
    doesn't duplicate), stop-on-review, per-store reminder toggle gating, the
    `remindersEnabledAt` historical-safety cutoff, and suppression (including cross-store
    isolation). Real Resend delivery was already confirmed live in production in an earlier
    session (not re-claimed tonight — no local credentials to test against).
    **FILES CHANGED:** none.

-   **TASK:** Production readiness sweep (env vars, secrets, debug code, migrations).
    **STATUS:** Complete. `.env` confirmed gitignored and never tracked. No hardcoded
    secrets found in source. No leftover debug `console.log` in non-test code. All 17
    Prisma migrations applied, none pending/uncommitted. Three untracked one-off diagnostic
    scripts found in `scripts/` (`check-previously-unmatched.ts`, `verify-import-counts.ts`,
    `verify-reviews-pagination.ts`) from an earlier debugging session, referencing a real
    merchant's data (Grace Store) — read-only, harmless, but stale; left in place since they
    predate this session and weren't asked to be removed. Build succeeds.
    **FILES CHANGED:** none.

**ROADMAP COMPLETION: ~82%.** Core pipeline (reviews, products, requests, email automation,
suppression, one-click branding) is functionally complete and code-verified. Remaining gaps
are entirely credential/infrastructure, not code: `OPENAI_API_KEY` for AI Summaries, and
stable tunnel access to finish live-verifying the Reviews routing fix.

**Database confirmed NOT reset/wiped/migrated tonight** — every DB interaction this session
was a read-only query. **No "Coming to Pro" feature was implemented, unlocked, or
relabeled.** **Nothing was committed or pushed.**

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
    [DECISIONS.md](./DECISIONS.md). Note: this live preview (`/appearance-preview`, iframed
    with `postMessage`-driven instant updates) already **is** the V2 roadmap's "Live Widget
    Preview" item — it reuses the real storefront rendering system, not a second mock
    renderer, and was built as part of V1, not V2.
-   **Brand Match** (2026-08-14) — deterministic Appearance-token extraction from the
    merchant's own Shopify brand settings (`Shop.brand`: primary color + logo), surfaced as a
    one-click "Apply my Shopify brand" action on the Brand Studio page
    (`app/services/brandMatch.server.ts`, wired into `app.appearance.tsx`). Gated behind the
    existing `canUseBrandStudio` permission (no new plan/tier). Deliberately not AI — a real,
    working "deterministic brand extraction" half, kept separate from any future AI-generated
    suggestion layer per the Phase 3 brief. Applies via the same live-previewed,
    Save/Discard-reversible draft flow every other Brand Studio control already uses; nothing
    is written until the merchant explicitly saves. Empty state (no brand color/logo
    configured in Shopify) links out to Shopify's own Brand settings. 6 unit tests
    (`brandMatch.server.test.ts`).
-   **Brand Studio V2 — AI-generated brand suggestion layer** (2026-08-18) — the AI half of
    Brand Match's Phase 3 brief, deliberately scoped to exactly two categories: accent color
    (`colors.starColor`) and typography (`typography.scale` + `letterSpacing`). Reuses the
    existing multi-provider AI abstraction (`app/services/ai/`) rather than a second one —
    `generateBrandSuggestion` added to the shared `AiProvider` interface and implemented by
    all three providers (OpenAI/Anthropic/Gemini), with strict validation
    (`parseBrandSuggestionJson` in `ai/shared.ts`: invalid hex color or letter-spacing value
    throws rather than substituting a fabricated value; out-of-range scale is clamped to the
    existing slider's 0.9–1.15 bounds). `app/services/brandSuggestion.server.ts` is the thin
    service wrapper (mirrors `aiSummary.server.ts`'s pattern), called by a new "Suggest with
    AI" action in `app.appearance.tsx`, surfaced as its own "AI Suggestion" section separate
    from (not a replacement for) Brand Match. Same permission gate (`canUseBrandStudio`),
    same live-preview/Save-Discard draft flow — nothing persisted until the merchant saves.
    11 unit tests (`ai/shared.test.ts`, `brandSuggestion.server.test.ts`). Live-verified in a
    fresh dev-preview session: the button renders and the AI call's error path (no API key
    configured in this environment) surfaces cleanly; Brand Match and Widgets confirmed
    unaffected. URL analysis and full brand-token generation remain explicitly out of scope
    for this pass — see the "Next" list below for the rest of Brand Studio V2's scope. No
    code changes pending for this item.
-   **Shopify Billing** — Free (Starter) / Pro (Growth, $9.99/mo, 14-day trial), Shopify
    Managed Pricing, development-store and Owner-plan bypass, centralized access gate
    (`app.tsx`) and feature gating (`services/permissions.ts`), verified end-to-end in
    production (subscription creation, trial, upgrade/downgrade, cancellation, webhook
    sync). Locked to exactly these two merchant-facing plans as of the 2026-08-10 security/
    billing hardening pass — the former third tier (Scale, $29.99/mo) has been removed from
    the public listing and has no subscribers; its `PlanId` and permissions are kept
    internally only so a pre-existing subscriber would never be silently downgraded. Features
    with no enforcement point yet are tagged "Coming soon" rather than claimed as available —
    see [DECISIONS.md](./DECISIONS.md)'s 2026-08-07 entry.
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
-   **Video Reviews** (2026-08-24) — one video per review (MP4/MOV, up to 100MB, up to 60
    seconds) alongside existing photo uploads, generalizing the same Shopify Files storage
    provider and review-media service rather than duplicating them
    (`app/services/storage/shopifyFiles.server.ts`, `app/services/reviewMedia.server.ts`).
    Server-side validation includes a dependency-free MP4/MOV box parser that reads real
    duration before upload — avoids a wasted upload+poll round trip, since Shopify's own
    `Video.duration` is null until processing completes; per-file upload failures are
    isolated so one bad video never breaks the rest of a review submission. Gated behind
    `canUseVideoReviews` (same permission system as everything else). Renders as a playable
    media item — thumbnail with play-icon overlay, lightbox playback — in the storefront
    review card/gallery and the admin review-detail panel. 33 unit tests
    (`reviewMedia.server.test.ts`, `shopifyFiles.server.test.ts`). Live-verified end-to-end in
    a fresh dev-preview session: real video upload through the storefront form, the Shopify
    Files upload+processing round trip, storefront card and lightbox playback, admin-panel
    rendering, and existing photo-review submission all confirmed working.

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
2.  Manually promote specific Store rows to `plan: "owner"` for internally-owned stores
    (a one-time, explicitly-approved DB write — see DECISIONS.md's 2026-08-07 entry)
3.  App Store listing assets (screenshots, demo store, listing copy, privacy policy) —
    update pricing/feature copy entered directly in the Partner Dashboard to match the
    Free/Pro lineup and its "Coming soon" tags once the listing text exists
4.  Resend inbound webhook (populates `delivered` / `opened` statuses)
5.  **BLOCKED — NEEDS REAL EXPORT SAMPLE.** Loox (JSON export, needs its own `Importer`, not
    `delimitedParser.server.ts`) / Stamped / Ryviu / Ali Reviews importer parsers. Audited
    2026-08-17: no real or sample export file for any of the four sources exists anywhere in
    this repo — only architectural placeholders (`ImportSource` type, `IMPORT_SOURCES` picker
    entries marked `available: false`, a comment noting the extension point). Do not build
    against a guessed/invented format — this is exactly what caused Judge.me's importer to
    reject every real file until it was rebuilt against an actual 2,540-row export. Needs a
    real export sample from each source before implementation starts on that source.
6.  Brand Studio V2 — remaining scope, now that deterministic Brand Match AND the AI
    suggestion layer (accent color + typography) have both shipped (see Completed above):
    URL analysis (extract brand signals from a merchant-supplied URL — no existing
    architecture for this yet) and a widget preset *marketplace* specifically (the 4 curated
    Widget Style presets — Minimal/Modern/Editorial/Luxury — already exist and are fully
    applied; "marketplace" would mean more/community presets, which is new scope, not a gap
    in what already ships). Full AppearanceTokens generation (card style, spacing, logo) via
    AI remains explicitly out of scope — the AI layer is deliberately limited to accent
    color + typography, matching Brand Match's own two categories.
7.  Public Review Pages
8.  Build the "Coming soon" features currently tagged on Free/Pro (video reviews, automatic
    email reminders, multiple email templates, advanced email styling, advanced analytics —
    see `plans.ts`). Separately, `permissions.ts` still grants the retired `scale` `PlanId`
    a further set (white label, custom email domain/SMTP, API access, webhooks, unlimited
    team members) that has no path to any merchant today since Scale isn't public — decide
    whether those fold into Pro or wait for a future tier before building them.
9.  Preserve verified-review provenance on Judge.me import and show a Verified Buyer /
    Verified Review badge on the storefront for imported reviews that were originally
    verified. Discovered during the Requests UX pass (2026-08-16): reviews imported from
    Judge.me that were verified at the source currently render with no Verified badge on our
    storefront — the importer isn't capturing/mapping that flag today.
