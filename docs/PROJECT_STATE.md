# PROJECT_STATE.md

## Current Phase

Live in production, one real merchant on the app. Finishing sprint checkpoint committed and
deployed (`d6231e4`). Premium UI/UX Redesign (all 10 core sections) is complete, passed a
final production-safety review, and is committed and live in production (`fec41f5`).
Separately, the new "Medals Showcase" homepage widget block (not part of the redesign pass)
is now also complete and ready to ship — see its own section below.

## Final Production Safety Review (2026-08-29)

Performed before committing/pushing the completed 10-section redesign, per Bilal's explicit
request. Two independent passes: a full static review (done directly, not delegated) and a
live corroboration walkthrough (delegated to a fork) across the whole app + storefront.

- **Diff review:** every line of the diff across all 12 redesign-touched files read directly.
  Confirmed each change is purely structural/CSS/accessibility — zero business logic touched,
  zero Coming-to-Pro gating logic touched (`billing/plans.ts`/`permissions.ts` have no diff
  at all), zero secrets in the diff, `.env` not staged/tracked/present in git status. `app.tsx`'s
  2-line diff (FloatingHelp) confirmed as pre-existing unrelated work, untouched by any
  redesign section.
- **Typecheck/tests/build:** independently re-run (not just trusted from per-section
  reports) — `npm run typecheck` clean, `npm test -- --run` 297/297 passing (25 files),
  `npm run build` succeeds (only pre-existing React Router v8 future-flag warnings).
- **Live verification (corroboration pass, all PASS):** navigation across all 12 admin pages
  by direct URL + in-app row click-through; Reviews/Products detail routing including the
  `/app/reviews/new` flow (confirms the original routing fix still holds); AI Review
  Summaries rendering with real content in 3 surfaces; Email Studio UI correct (this store's
  Reminder tabs are genuinely unlocked — confirmed it's on the Pro plan, not an accidental
  unlock); Brand Studio's Desktop/Mobile toggle confirmed switching `aria-pressed` and visual
  state live; Widgets gallery install-detection correct; reduced-motion fix confirmed live
  with actual scroll-position measurements (instant jump vs. animated scroll); mobile/375px
  checked on both admin (Reviews split-layout collapse) and storefront (badges, carousel) —
  no genuine issues found. Zero database writes occurred during verification (observation +
  one local-state toggle click only — no form submissions, no vote clicks, nothing saved).
- **Verdict: safe to commit.** Nothing found that blocks approval. Waiting on Bilal's
  explicit go-ahead before staging/committing/pushing.

## Medals Showcase — new feature (DONE ✓, 2026-08-29)

Not part of the redesign pass. Bilal asked for a new homepage-placeable widget block
showing earned achievement medals as realistic brushed-metal medallions (reference:
physical commemorative-medal photography — circular metal disc, engraved/embossed detail,
edge bevel, material depth — explicitly NOT game-achievement/trophy-icon styling). Also
applies to the admin Medals page for visual consistency, per Bilal's choice. Scope
confirmed with Bilal via two decisions: (1) update the admin Medals page too, not just the
new storefront widget: yes. (2) show all earned medals on the new widget (no
merchant-configurable count/limit): yes.

Explicitly preserved, unchanged: the Achievement database model/schema, the earning/
evaluation logic (`achievements.server.ts`'s `evaluateAchievements`), and the existing
small quiet-pill medal display already shown next to reviewer content inside the Product
Reviews Widget (`imagyn-component-medals.css`) — that was a separate, deliberately
restrained design decision and stays exactly as-is; this is an additional, more prominent
surface, not a replacement.

Design: four brushed-metal finishes (pewter/silver/graphite/onyx), one per achievement
tier — a lightness progression standing in for a real medal's bronze/silver/gold ladder,
kept strictly monochrome (no added hue anywhere) to match Imagyn's brand restraint. Tier 4
("onyx") bottoms out at `#0d0e0f`, the exact near-black of the brand mark itself
(`public/assets/imagyn-app-logo.svg`). Each medallion is a beveled disc (radial-gradient
face + linear-gradient rim), an engraved groove near the rim, and a 3-layer emboss for the
category glyph (dark multiply copy + light screen copy + true-position base) — flat SVG
shapes only, no filters, so it stays crisp and cheap even very small. Implemented once in
React (`app/components/medals/Medallion.tsx`, admin) and mirrored in vanilla JS
(`extensions/imagyn-review-widgets/assets/medals-showcase.js`, storefront) since the two
run in separate bundles — both files cross-reference each other in comments to stay in
sync.

Files so far: `app/components/medals/Medallion.tsx` (rewritten), `medallion.module.css`
(rewritten), `app/routes/app.medals.tsx` (passes `tier` through), `achievements.server.ts`
(+`tier` field on the already-existing `StorefrontMedal` read-only DTO — no schema/earning
logic change), `achievements.server.test.ts` (updated field-shape assertion), new
`app/routes/api.reviews.medals.tsx` (read-only store-wide proxy endpoint, mirrors
`api.reviews.featured.tsx`'s exact pattern), new `extensions/imagyn-review-widgets/blocks/
medals_showcase.liquid`, new `medals-showcase.js`, new
`imagyn-component-medals-showcase.css`. Also registered the new block in the admin Widgets
gallery (`app.widgets.tsx` — new card + `MedalsShowcaseThumbnailPreview` using the real
`Medallion` component; `app.widgets.module.css`), install detection
(`widgetInstallDetection.server.ts` — new `"medals-showcase"` key, `resolveHomepageOnlyWidget`
generalized to take its "not on homepage" reason as a parameter instead of a hardcoded
Review-Carousel-specific string), and the add-to-theme allow-list
(`app.widgets.add-to-theme.tsx`).

**A real bug was found and fixed during live verification** (not caught by typecheck/tests,
only by looking at the actual rendered result): the per-finish CSS blocks in
`medallion.module.css` set `.medallionGlyphBase, .medallionGlyphStrokeBase { fill: X; stroke:
X; }` as one combined rule. `.medallionGlyphStrokeBase` is used on the Ranking category's
hollow outer-ring circle (`fill="none"` in the JSX) — the CSS class's `fill: X` declaration,
being more specific than the base rule's `fill: none`, silently overrode the JSX attribute
and filled that "ring" solid, ballooning it into a giant filled blob that swallowed the small
center dot. Confirmed live (inspecting the rendered circle's actual computed `fill`) before
fixing — split into two separate rules per finish (`.medallionGlyphBase { fill: X }` and
`.medallionGlyphStrokeBase { fill: none; stroke: X }`) so the hollow ring stays hollow. Also
added `isolation: isolate` to `.medallion` as a defensive fix for the emboss effect's
`mix-blend-mode` (multiply/screen) — confirmed via testing this wasn't actually the cause of
the ring bug, but is still correct/necessary to keep each medallion's blend scoped to its own
face when several render together (this gallery card, or the storefront showcase grid),
mirrored in `medals-showcase.js` via inline `style="isolation:isolate"`. Also fixed a
legibility issue from an earlier local-only check: initial glyph colors matched each finish's
own face tone too closely (looked great large, nearly vanished at 24px, and made the Trust
shield read as a solid blob) — changed to a deliberate contrast tone per finish (dark glyph on
light finishes, light glyph on dark finishes, still strictly grayscale).

Typecheck clean, 297/297 tests passing, build succeeds. Live-verified in the real embedded
admin (verveonline.myshopify.com): admin Medals page shows a real unlocked pewter medal
(clear checkmark, correct bevel/gradient) alongside correctly-unchanged locked medals; Widgets
gallery shows the new "Medals Showcase" card with an honest "AVAILABLE" status (this store has
storefront password protection on, so live detection correctly reports "can't be checked
automatically" rather than guessing) and all three preview medallions (silver checkmark,
graphite shield, pewter ring) rendering correctly and distinctly at real size after the fix.

**Storefront route confirmed live, full visual placement still pending Bilal's go-ahead.**
Hit the new `/apps/reviews/medals` endpoint directly through Shopify's real App Proxy
(unauthenticated `curl`, no browser) — it returns the identical 302-to-`/password` response as
the already-shipped, already-proven `/apps/reviews/featured` (Review Carousel) endpoint on this
same store, confirming the new route is correctly wired into the App Proxy and behaves exactly
like a working sibling endpoint under this store's real (password-protected) conditions — this
password gate is a pre-existing property of this dev store, not something new to this feature.
Actually placing the block on the theme to see it rendered pixel-for-pixel (via "Open Theme
Editor") was attempted and correctly blocked by this environment's own safety guardrails: doing
so — even unsaved, even on a test store — modifies the merchant's live theme configuration, which
requires Bilal's explicit request, not just a verification instruction. Left for Bilal to do
himself, or to explicitly authorize, rather than done autonomously.

## Premium UI/UX Redesign Roadmap

**Design hierarchy (added 2026-08-28, applies from Section 3 onward):**
1. Shopify-native usability first.
2. Apple-level design discipline (`.claude/skills/imagyn-apple-inspired-design`).
3. IMAGYN brand identity where it adds personality/differentiation — the actual mark
   (`public/assets/imagyn-emblem.svg`/`imagyn-app-logo.svg`: a monochrome 9-dot geometric
   grid + confident sans wordmark, `#0d0e0f` on white) and voice ("confident, minimal,
   trustworthy, premium" per `docs/08_BRANDING.md`). Note: the existing admin design system
   already substantially embodies this — Helvetica, near-black, restraint — so this is a
   lens for judgment calls, not a mandate to add logo marks everywhere. Never let it make
   the Shopify admin feel like a marketing site.

1. Global app shell/navigation — **DONE ✓** (2026-08-28). Audited the shared header pattern
   (`app.shell.module.css`) across all 12 admin pages + the `Container` primitive. Found one
   genuine drift: Dashboard's header was missing the shared `headerContent` wrapper (used by
   every other page), meaning its subtitle lacked the standard `max-width: 40rem` readability
   constraint. Fixed to match the established pattern exactly. Confirmed the two other
   `.page`-level overrides that exist (Medals' tighter gap, Brand Studio's wider max-width)
   are both deliberately documented exceptions, not drift — left unchanged. Live-verified, no
   regression, no visual change beyond the one structural fix.
2. Dashboard — **DONE ✓** (2026-08-28, no code changes needed). Full audit — every component
   (`Section` primitive, attention cards, Trust Overview stats, Rating Distribution, AI
   Spotlight, Recent Activity) already meets the design system bar: no card-wall (numbers sit
   directly on the page background per the design system's own "typography does the work"
   comment), consistent interaction states (global `:focus-visible`, hover lift respecting
   `prefers-reduced-motion`), tabular-nums alignment, sensible empty state, restrained color
   (accent used only for the one active-state indicator + rating fill). Visually confirmed
   top-to-bottom in the live embedded admin. The one real issue (header wrapper) was already
   fixed in Section 1. Genuinely nothing else to change under a consistency/polish scope.
   **Unrelated observation, not fixed:** "Recent Activity" surfaces leftover QA test data
   (Image Regression Tester, Video QA Tester rows) on the merchant-facing Dashboard — same
   test rows flagged in the finishing-sprint session log below; still awaiting a cleanup
   decision from Bilal, not touched.
3. Reviews — **DONE ✓** (2026-08-28). Full audit of `app.reviews.tsx` (list + detail panel,
   bulk actions, filters, import/export) and its stylesheet against the design system and the
   new brand-hierarchy lens. Header/toolbar pattern, spacing tokens, Section usage, color
   (accent reserved for stars/active states, no unnecessary color), empty/loading/error
   states, motion (`prefers-reduced-motion` respected), and accessibility (aria-labels, keyboard
   row navigation) were all already consistent with the established system — no changes
   needed there. One genuine finding: the detail panel's subtle top-to-bottom gradient
   initially looked like drift against the redesign's "avoid gradients" direction, but the
   identical gradient value is already used by Requests' and Widgets' matching detail panels
   — an established, intentional pattern for sticky detail panels specifically (not the flatter
   `color-mix` tint used for inline content sections) — left unchanged. The one real fix: removed
   four dead CSS rules (`.errorDump`, `.replyLabel`, `.replyTextarea`, `.detailValue`) left over
   from an earlier refactor to Polaris `TextField` — confirmed unused via full-repo grep before
   removing. Live-verified in the real embedded admin against production data (83 reviews):
   list, detail panel, AI summary callout, and moderation actions all render correctly.
4. Products — **DONE ✓** (2026-08-28). Full audit of the Products list (`app.products.tsx`)
   and detail view (`app.products_.$id.tsx`, AI Review Summary + reviews list) against the
   design system. Structurally already consistent: correct `shellStyles.header`/
   `.headerContent` usage on both pages, shared `.searchInput`/`.searchField` styling
   byte-identical to Reviews', shared empty/error-state composition from `shared.module.css`,
   accessible search labeling. One genuine finding: `.productCell:focus-visible` in
   `app.products.module.css` duplicated the app-wide global `:focus-visible` rule in
   `design-system.css` exactly (same outline color/offset, just with a pointless `#000`
   fallback on a variable that's always defined) — confirmed via full-repo grep it was the
   only per-component focus-visible override anywhere in the codebase; removed it, the global
   rule already covers this element. Considered and declined two other candidates: the Card-
   per-section layout on the detail page (also used by Requests/Reviews forms — an established
   pattern, not local drift) and the `0.16em` label letter-spacing (inconsistent app-wide
   across several values, but that's a pre-existing sitewide token question, not something
   local to Products — out of scope for a single-page pass). Live-verified in the real
   embedded admin against production data: list view, product detail overview, AI Review
   Summary (with real generated content), and reviews list all render correctly, no
   regression from the CSS removal.
5. Requests — **DONE ✓** (2026-08-28). Full audit of `app.requests.tsx` (list + detail panel,
   1638 lines) and `app.requests.module.css` against the design system, sibling pages
   (Products/Reviews), and the brand-identity lens. Already clean: byte-identical `.header`/
   `.headerActions` pattern to Products, identical `.searchInput` styling to Reviews/Products,
   no local `:focus-visible` overrides (global rule already covers every interactive element),
   correct `prefers-reduced-motion` handling on row hover transitions, the detail panel's
   gradient/left-accent-border match the established Reviews/Widgets pattern, Card+BlockStack
   inside the modal's "Recipient preview" matches the same convention used in Products' modals.
   Verified zero unused CSS classes via a full cross-reference against every consuming file
   (the route, `RequestLifecycleTimeline.tsx`, `RequestStatusBadge.tsx`) — unlike Reviews,
   nothing dead to remove here. No genuine issues found; no code changes made. Live-verified in
   the real embedded admin against production data (55 requests): list view, table columns,
   and detail panel (status, product/order/email meta, schedule) all render correctly.
6. Email Studio — **DONE ✓** (2026-08-28). Full audit of `app.email-studio.tsx` (496 lines)
   and `app.email-studio.module.css` against the design system, sibling pages, and the
   brand-identity lens. Already clean: correct header pattern, `.textInput`/`.textArea`
   byte-identical to Widgets' established input styling, no local `:focus-visible`
   overrides, reduced-motion already handled via the shared `skeletonShimmer` primitive.
   One genuine fix: the Reminder-tab lock indicator used a decorative emoji (🔒) — the only
   emoji anywhere in the codebase — where every other locked/Pro-gated feature (Brand
   Studio's `.comingSoonTag`, Widgets' `.comingSoonPill`) uses a small muted text tag.
   Replaced with a `.lockedTag` "Pro" label matching that established convention. Live-
   verified the page renders correctly with no regression against real production data; the
   locked-tab state itself couldn't be visually observed on this dev store since it
   currently has `canUseEmailReminders: true` (Reminder tabs unlocked) — verifying it live
   would require changing the store's plan tier, a DB write out of scope without approval.
   Change verified correct via code review + typecheck instead.
7. Widgets — **DONE ✓** (2026-08-29). Full audit of `app.widgets.tsx` (985 lines) and
   `app.widgets.module.css` against the design system, sibling pages, and the brand-identity
   lens. New this section: installed the official `apple-design` Claude skill (from
   github.com/emilkowalski/skills, fetched verbatim and verified byte-identical) at
   `.claude/skills/apple-design/SKILL.md`, per Bilal's request — applied as a judgment lens
   for motion decisions (kill unnecessary latency, respect `prefers-reduced-motion`, anchor
   popovers to their trigger), not its gesture/spring mechanics, which don't apply to a
   Shopify settings page. Existing motion here was already correct: `.widgetCard:hover`
   already had a `prefers-reduced-motion` guard, Polaris `Popover` already anchors to its
   activator natively. Two genuine dead-CSS issues found and fixed: a `[data-reserved="true"]`
   attribute selector (plus its `:hover` variant) that was never actually set on any element
   — a leftover from when "Featured Collection Badge"/"Related Products Badge" were separate
   reserved cards before being merged into Collection Rating Badge's description — and an
   unused `.installReasonNote` class. Both confirmed dead via repo-wide grep before removal.
   Typecheck clean, 297/297 tests passing, build succeeds. Live-verified in the real embedded
   admin (verveonline.myshopify.com, real production data): gallery view (all three
   theme-editor cards showing "Installed" with live-detected block status) and the
   Customize/inspector view (live preview, Actions menu) both render correctly, no regression.
8. Brand Studio — **DONE ✓** (2026-08-29). Full audit of `app.appearance.tsx` (885 lines,
   covering both the widget/theme branding controls and the separate pre-existing AI Brand
   Suggestion feature that share this page) and `app.appearance.module.css` against the
   design system, sibling pages, and both design skills (`imagyn-apple-inspired-design` +
   the newly installed official `apple-design`, applied as a motion-judgment lens only —
   no springs/gestures introduced on this settings page). Three genuine, safe fixes: (1)
   the Desktop/Mobile preview toggle — a `role="group"` segmented control identical in
   shape to the ones in Reviews and Analytics — was missing `aria-pressed` on its buttons,
   which those sibling pages already have; added it. (2) the "Widget Style" preset cards are
   real, clickable `<button>` elements with zero hover feedback, while every other
   selectable card in the app (`.attentionCard`, `.widgetCard`) pairs hover with its active
   state; added a `:hover` border-color change (skipped for the active/disabled variants so
   it doesn't fight `.presetCardActive`'s accent border) — confirmed visually via a
   before/after hover screenshot. (3) added a local comment documenting the page's one
   intentional `.page { max-width }` override, matching the convention every other page's
   single-property override already follows (previously only referenced from a comment in a
   different file). Declined to touch: the lime `.heroSection` treatment and the hardcoded
   `#f5f5f5` surface color are both explicitly documented, intentional, and shared
   identically with Widgets — not drift. Typecheck clean, 297/297 tests passing, build
   succeeds. Live-verified in the real embedded admin (verveonline.myshopify.com): One-Click
   Branding, AI Suggestion, Widget Style grid, and the live preview all render correctly;
   the new preset-card hover state was confirmed rendering (a visibly stronger border on the
   hovered card vs. its neighbors) via a direct screenshot comparison.
9. Remaining merchant pages (Medals, Analytics, Settings, Billing) — **DONE ✓ (2026-08-29)**.
   Audited all four against the design system, sibling pages, and both design skills
   (custom `imagyn-apple-inspired-design` + the newly installed official `apple-design`
   skill, applied only as a motion-judgment lens — no springs/gestures on a settings admin).
   Medals and Analytics needed zero changes — both already correct (Analytics' range-toggle
   `aria-pressed` segmented control was in fact the reference pattern Brand Studio's toggle
   was fixed to match in section 8). Two genuine structural fixes: (1) Settings had a local
   `.header` override in `app.management.module.css` that was dead code — the header has a
   single child (`headerContent`), so a `gap` on `.header` itself has zero visual effect,
   the same root cause as the Dashboard bug fixed in section 1 — removed. (2) Billing's
   header did not use `shellStyles.headerContent` at all (the only page in the app that
   didn't) — eyebrow/title/subtitle and the dev/trial/frozen banners sat as direct header
   children, relying on a parallel local `max-width: 40rem` override to approximate what
   `headerContent` already provides everywhere else. Restructured to wrap all of it in
   `headerContent`, matching every other page, and removed the now-redundant local override.
   Files changed: `app/routes/app.settings.tsx`, `app/styles/app.management.module.css`,
   `app/routes/app.billing.tsx`, `app/styles/app.billing.module.css`. Typecheck clean,
   297/297 tests passing, build succeeds. Live-verified in the real embedded admin
   (verveonline.myshopify.com, real production data) — Medals (achievement grid with real
   progress bars), Analytics (real review/request stats + trend chart), Settings (Moderation
   Rules/Automatic Requests/Reminder Emails/Diagnostics), and Billing (Free/Pro plan cards,
   dev-store banner correctly capped to the header's measure) all render correctly with no
   regressions.
10. Customer-facing review widget — **DONE ✓ (2026-08-29)**. Full audit of the storefront
    theme app extension (`extensions/imagyn-review-widgets/`: 4 Liquid blocks, ~20 CSS files
    including a mature `imagyn-tokens.css`/`imagyn-typography.css`/`imagyn-utilities.css`
    foundation and per-component stylesheets, and the JS widgets — rating-badge.js,
    collection-rating-badges.js, review-carousel.js, reviews-widget.js), cross-referenced
    against `docs/STOREFRONT_DESIGN_SYSTEM.md` and both design skills (the custom
    `imagyn-apple-inspired-design` skill's admin-vs-storefront distinction — this surface
    optimizes for merchant-brand compatibility, not Imagyn's own identity — and the newly
    installed official `apple-design` skill, applied only as a motion-judgment lens). This
    codebase is exceptionally mature already: every token, spacing value, and motion curve
    is centralized and commented with its rationale, every transition already has a
    `prefers-reduced-motion` variant, accessibility (44px touch targets, focus rings, aria
    labels, screen-reader text for star ratings) is already built in throughout. Found one
    genuine, real inconsistency: two smooth-scroll call sites (`rating-badge.js`'s
    "scroll to reviews" action, `review-carousel.js`'s prev/next nav buttons) used
    unconditional `behavior: "smooth"`, while a third, near-identical call in
    `reviews-widget.js` (its own scroll-to-write-review-form) already correctly checked
    `prefers-reduced-motion` first — added the same guard to the other two, per
    `STOREFRONT_DESIGN_SYSTEM.md` §10's "not optional per component; enforced at the token
    level" rule. Also confirmed one already-self-documented piece of technical debt (not
    fixed, just verified it's genuinely intentional and already flagged, not silent drift):
    `rating-badge.css`/`rating_badge.liquid` predates the shared token/component system and
    still falls back to a hardcoded star color instead of `--imagyn-color-star` — both
    `imagyn-component-badge.css`'s own header comment and a `rating-badge.js` code comment
    already call this out as "a candidate to adopt this same component in a future pass,"
    so this is known, deliberate, tracked debt, not something introduced or missed this
    session — flagging it here again for whenever that migration is prioritized, since it
    touches the live Rating Badge on every merchant storefront and is out of scope for a
    consistency-only pass. Files changed: `extensions/imagyn-review-widgets/assets/rating-badge.js`,
    `extensions/imagyn-review-widgets/assets/review-carousel.js`. Typecheck clean, 297/297
    tests passing, build succeeds. Live-verified on the real storefront (verveonline.myshopify.com,
    real production data): homepage Featured Collection badges (16 found), product page
    Rating Badge ("★★★★★ 4.5 (15 reviews) · Write a review"), Review Summary hero, Histogram,
    AI Review Summary, Medals (quiet outline pills), Customer Photos gallery (including a
    video thumbnail's hover state), Review Cards list (verified badges, store replies,
    helpful voting), and Related Products' Collection Rating Badges (2 found) all rendered
    correctly with no visual regressions from the reduced-motion fix.

    **All 10 core sections of the Premium UI/UX Redesign are now complete.** Only the
    separately-tracked FUTURE website-redesign phase (below) remains, and it is explicitly
    not started.
11. Website redesign (marketing site, separate `imagyn-website` repo) — **FUTURE ○**. Same
    premium treatment, so product + website feel like one ecosystem. Not started, not
    scoped. When reached: first assess whether additional design skills/references are
    needed before assuming the current toolset is sufficient — stop and ask before
    adding/installing anything substantial.

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
