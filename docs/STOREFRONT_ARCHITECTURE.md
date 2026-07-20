# Imagyn Reviews — Storefront Component Architecture

This document defines the component architecture for the on-page Reviews Widget, following the visual and interaction rules already established in `STOREFRONT_DESIGN_SYSTEM.md`. It is a software architecture spec, not a visual one — no colors, spacing, or type here, only responsibility, data, and behavior.

No implementation code is included. This is the blueprint the implementation will follow.

---

## Scope: what's in this tree, what isn't

This document covers the **Reviews Widget** — the full, on-page review experience that lives further down a product page. It does **not** cover the Rating Badge or Collection Badges, which are separate, already-shipped components living outside this tree (see `STOREFRONT_DESIGN_SYSTEM.md` §15's hierarchy diagram). The one connection between them: the Rating Badge's "click to scroll" behavior targets this tree's root DOM node, and nothing more — the two systems don't otherwise share state.

---

## Architectural model

This is a vanilla-JS, Liquid-rendered system — there is no framework runtime (no React/Vue) anywhere in this project, and this architecture doesn't introduce one. "Props," "state," and "events" below describe a **framework-agnostic component discipline**, not literal framework APIs:

- **Props** — the data a component is initialized or re-rendered with. In practice: values read from data attributes, or values passed as plain JS objects when a parent component constructs/updates a child.
- **State** — data a component owns and mutates internally, invisible to its parent unless surfaced through an event.
- **Events** — native browser `CustomEvent`s, dispatched on the widget's root element and consumed via `addEventListener`. This is the same pattern already used by the shipped Collection Badges and Rating Badge components (`shopify:section:load` listening, DOM-attribute-driven config) — extended here into a full parent/child event vocabulary rather than introduced fresh.

**Data flows down, events flow up.** `ReviewsWidget` is the single owner of all server data (the initial summary + first page of reviews, fetched once via the existing App Proxy batch pattern). Every other component in the tree is either a pure renderer of the props it's given, or owns a small, local piece of interaction state (open/closed, form values, vote-pending) that it reports upward via an event rather than mutating shared data directly. No component other than `ReviewsWidget` talks to the network for *read* data. (`Write Review` and `Helpful` are documented exceptions for *write* actions — see their sections.)

**Event naming convention:** `imagyn:<component>:<action>`, e.g. `imagyn:filters:change`, `imagyn:pagination:loadmore`, `imagyn:review:submitted`.

**Re-render, not rebuild.** When `ReviewsWidget` receives a `filters:change` or `pagination:loadmore` event, it re-fetches and either **replaces** (`Filters` change → new result set) or **appends** (`Pagination` load-more → same result set, more rows) the data handed to `Review List`. This distinction is called out per-component because it affects scroll position and perceived performance, not just data correctness.

---

## Component Tree

```
ReviewsWidget
├── Summary
├── Histogram
├── Recommendation
├── AI Summary
├── Filters
├── Gallery
├── Review List
│   ├── Review Card
│   │   ├── Media
│   │   ├── Helpful
│   │   └── Verified Badge
├── Pagination
└── Write Review
```

One clarification on nesting: `Media`, `Helpful`, and `Verified Badge` are rendered **per review card**, not as siblings of `Review List` at the same level as `Review Card` — each `Review Card` instance composes its own copy of all three. This is the architecturally correct reading of the given tree and is reflected in each component's spec below.

---

## ReviewsWidget

**Responsibility.** The root container and sole data owner. Performs the initial batched fetch (summary, histogram counts, first page of reviews) via the existing App Proxy pattern, holds top-level loading/error state, and initializes every child with the resulting data. Is the DOM node other page elements (notably the Rating Badge) locate to scroll to.

**Props.** `productId` (Shopify's numeric ID, read from Liquid the same way the shipped Collection Badges/Rating Badge already do), theme overrides (star color, text color — same override mechanism already shipped for the badge components).

**State.** `status: 'loading' | 'ready' | 'error'`, `summary`, `histogramCounts`, `reviews[]` (current page), `activeFilters`, `pagination { nextCursor, hasMore }`.

**Events.**
- Emits: `imagyn:widget:ready` once the initial fetch resolves (so page elements outside this tree, like the Rating Badge, can safely enable their "scroll to reviews" affordance only once there's something to scroll to).
- Listens: `imagyn:filters:change` (replace `reviews[]`), `imagyn:pagination:loadmore` (append to `reviews[]`), `imagyn:review:submitted` (update `summary`/count optimistically — see Write Review's note on pending-status reviews).

**Responsive behaviour.** Full width of its theme-section slot. Internally reflows `Summary` + `Histogram` + `AI Summary` from a two-column desktop arrangement to a single stacked column below the mobile breakpoint; this reflow is `ReviewsWidget`'s responsibility, not each child's, since it's a layout decision about the relationship between siblings.

---

## Summary

**Responsibility.** Displays the average rating and total review count — the first full-detail trust signal a shopper reaches (distinct from the compact Rating Badge higher up the page).

**Props.** `averageRating`, `totalReviews`.

**State.** None — purely derived from props.

**Events.** None emitted or listened to. Pure presentational component.

**Responsive behaviour.** Numeral and count sit inline on desktop; stack vertically only if the available width genuinely can't fit them inline (narrow mobile viewports at large system font sizes) — this is a fallback, not the default mobile layout.

---

## Histogram

**Responsibility.** Renders the 5-star distribution as five proportional horizontal bars.

**Props.** `ratingCounts: { 5: n, 4: n, 3: n, 2: n, 1: n }`, `totalReviews`.

**State.** None required for v1. A future click-to-filter interaction would add `hoveredBar` for a preview tooltip, but no hover state exists yet.

**Events.**
- Emits: `imagyn:histogram:bar-click` with `{ rating }` — reserved for a future "click a bar to filter by that rating" interaction. `Histogram` doesn't know about `Filters` directly; it only announces the click. `ReviewsWidget` (or `Filters` itself, listening on the shared root) decides what to do with it. This decoupling is deliberate: `Histogram` should never need to change if `Filters`' internals change.

**Responsive behaviour.** Bars remain full-width at every breakpoint. Count labels may abbreviate (e.g. "128" rather than "128 reviews") below a width threshold to avoid text wrapping inside the bar row.

---

## Recommendation

**Responsibility.** Renders a condensed cross-sell row ("customers also mention…") — title and rating only, no review body.

**Props.** `recommendedProducts[]`, each `{ productId, handle, title, image, averageRating }`.

**State.** `status: 'loading' | 'ready' | 'empty'`.

**Events.** None — pure display, native links to other product pages (no client-side navigation interception needed).

**Responsive behaviour.** Horizontal swipe row on mobile, matching `Gallery`'s scroll pattern rather than inventing a third interaction model; becomes a static row/grid on desktop when horizontal space allows all items to fit without scrolling.

**Open dependency.** Product-recommendation data isn't produced by any endpoint that exists yet — this component has a real, currently-unmet backend dependency, distinct from every other component in this tree, which map directly to data already returned by `GET /api/reviews`. Flagged here so it isn't assumed to be free to build.

---

## AI Summary

**Responsibility.** Renders a synthesized summary of review sentiment, always clearly labeled as AI-generated (per `STOREFRONT_DESIGN_SYSTEM.md` §16 — a text label, never a decorative "AI" visual treatment).

**Props.** `summaryText`, `generatedAt` (optional, for an "as of [date]" disclosure).

**State.** `status: 'loading' | 'ready' | 'unavailable'`. When `unavailable` (generation failed, or not yet run for this product), the component renders nothing rather than an empty or broken block — consistent with the badge's "true absence over empty state" rule.

**Events.** None.

**Responsive behaviour.** Text reflows naturally within its container; no distinct mobile treatment beyond standard line-length constraints already governed by the type scale.

**Open dependency.** No AI summarization pipeline exists yet. This component's data source is entirely future work.

---

## Filters

**Responsibility.** Owns the currently-active filter/sort criteria for `Review List` and renders the controls to change them. Deliberately mirrors the shape of `ReviewQueryOptions` already defined in `review.server.ts` for the admin-side review query (`status`, `rating`, `verifiedPurchase`, `search`, date range) rather than inventing a parallel filter vocabulary — the storefront-facing filter set is a subset of fields already proven out server-side, scoped down to what a shopper (not a merchant) would plausibly want: rating and verified-purchase, primarily.

**Props.** `availableRatings` (which star values actually have at least one review, so empty options can be disabled rather than shown as dead ends).

**State.** `activeFilters: { rating?: number, verifiedPurchase?: boolean, sort?: 'newest' | 'highest' | 'lowest' | 'most-helpful' }`.

**Events.**
- Emits: `imagyn:filters:change` with the full new filter object, any time a control changes.
- Listens: `imagyn:histogram:bar-click`, to update its own `rating` filter when a shopper clicks a histogram bar (see Histogram's decoupling note above).

**Responsive behaviour.** Inline filter bar on desktop. Collapses into a single "Filter" trigger opening a bottom sheet on mobile, per `STOREFRONT_DESIGN_SYSTEM.md` §14 — this is a hard requirement, not an option left to implementation discretion.

---

## Gallery

**Responsibility.** The aggregated, product-level media strip — every photo/video across *all* reviews for this product, browsable independent of any single review. Distinct from the per-review `Media` component nested inside each `Review Card`, which only shows that one review's attachments; this distinction is easy to conflate and is called out explicitly for that reason.

**Props.** `mediaItems[]`, each `{ url, type, reviewId }` — `reviewId` is retained so a shopper can jump from a photo to the full review behind it.

**State.** `lightboxOpenIndex: number | null`.

**Events.**
- Emits: `imagyn:gallery:item-click` with `{ index, reviewId }`; `imagyn:gallery:jump-to-review` with `{ reviewId }` when a shopper chooses to view the full review behind a photo — `ReviewsWidget` or `Review List` listens and scrolls/highlights the matching `Review Card`.

**Responsive behaviour.** Horizontal swipe strip on mobile; multi-row grid on desktop, per `STOREFRONT_DESIGN_SYSTEM.md` §16.

---

## Review List

**Responsibility.** Renders the current page of reviews as a list of `Review Card`s, and owns the empty-state display when the active filters produce zero results. Does not fetch independently — it is a pure renderer of whatever `ReviewsWidget`'s current `reviews[]` state is.

**Props.** `reviews[]` (current page, already filtered/sorted by the server), `status: 'loading' | 'ready' | 'empty' | 'error'`.

**State.** None beyond what's passed in.

**Events.** No new events of its own. Events from individual `Review Card`s (and their `Media`/`Helpful` children) bubble upward via native DOM event bubbling — `Review List` doesn't need to intercept or re-dispatch them, since `CustomEvent`s bubble by default unless a child explicitly stops propagation.

**Responsive behaviour.** Single column at every breakpoint — never a multi-column card grid. This is a deliberate density choice (per `STOREFRONT_DESIGN_SYSTEM.md`'s Stripe-Dashboard-influenced density principle for Review Cards), not a responsive fallback.

---

## Review Card

**Responsibility.** Renders one review's full content (reviewer name, star rating, date, title, body) and composes that review's `Media`, `Helpful`, and `Verified Badge`.

**Props.** The full review object: `id`, `reviewerName`, `rating`, `title`, `content`, `createdAt`, `verifiedPurchase`, `photoUrls`, `helpfulCount`, `merchantReply` (all fields already present on the existing `Review` model — nothing new required here).

**State.** `expanded: boolean` — governs the "read more" truncation of long review bodies.

**Events.**
- Emits: `imagyn:review:expand-toggle`. Does not emit helpful-vote or media-click events itself — those originate from and are emitted by its `Helpful`/`Media` children directly, then bubble.

**Responsive behaviour.** Truncates body text (roughly 4 lines) with a "Read more" affordance below a height/width threshold on mobile; shows full text by default on desktop, where horizontal space makes truncation less necessary.

---

## Media (per review)

**Responsibility.** Renders the photo/video thumbnails attached to **one specific review**, and opens a lightbox on click.

**Props.** `photoUrls[]`, `reviewId`.

**State.** None — delegates actual lightbox rendering to the same shared lightbox instance `Gallery` uses, rather than each `Review Card` owning a duplicate lightbox implementation.

**Events.**
- Emits: `imagyn:media:item-click` with `{ reviewId, index }` — handled by the shared lightbox the same way `Gallery`'s click event is.

**Responsive behaviour.** Thumbnail row wraps or scrolls horizontally depending on count. 44×44px minimum touch target applies to each thumbnail regardless of its visual size (per `STOREFRONT_DESIGN_SYSTEM.md` §14).

---

## Helpful

**Responsibility.** The "was this helpful?" vote control for one review.

**Props.** `reviewId`, `helpfulCount`, `hasVoted` (derived from local storage, since shoppers aren't authenticated — there's no customer account to key a vote to server-side).

**State.** `voted: boolean`, `optimisticCount` — the displayed count updates immediately on click, before (or regardless of) server confirmation, per the "count simply updates, no celebratory animation" rule in `STOREFRONT_DESIGN_SYSTEM.md` §16.

**Events.**
- Emits: `imagyn:helpful:toggle` with `{ reviewId, voted }`.

**This is the one component in the tree, besides Write Review, that talks to the network directly** rather than routing through `ReviewsWidget`'s central fetch — a helpful-vote is a small, fire-and-forget mutation with no need to re-fetch the whole review list afterward.

**Responsive behaviour.** 44×44px touch target at every breakpoint, independent of the visible icon's size.

**Open dependency.** No helpful-vote endpoint exists in the backend yet — this is new work, not a wrapper around something already shipped.

---

## Verified Badge

**Responsibility.** A small, non-interactive indicator that a review is tied to a verified purchase.

**Props.** `verified: boolean`.

**State.** None.

**Events.** None.

**Responsive behaviour.** None — identical at every breakpoint. When `verified` is `false`, the component renders nothing (not a "not verified" negative state) — matching the badge system's general "absence over empty affordance" principle.

---

## Pagination

**Responsibility.** Owns the "load more" control for `Review List`.

**Props.** `hasMore: boolean`, `nextCursor` — the same cursor-pagination shape `review.server.ts` already returns from `getStoreReviews`/`getProductReviews` (`nextCursor`, `hasMore`), reused as-is rather than redefined for the storefront.

**State.** `loading: boolean` — true while a load-more request is in flight, preventing a double-submit from a second click before the first resolves.

**Events.**
- Emits: `imagyn:pagination:loadmore`. `ReviewsWidget` listens, fetches the next page using `nextCursor`, and **appends** the result to `reviews[]` — explicitly not a replace, since the whole point of "load more" over numbered pages is that scroll position and previously-rendered cards are preserved.

**Responsive behaviour.** "Load more" button, not numbered pages, at every breakpoint (per `STOREFRONT_DESIGN_SYSTEM.md` §16 — numbered pagination is explicitly reserved for a future dedicated all-reviews page, not this widget). Touch target sizing still applies on mobile even though the button's visual size doesn't need to change.

---

## Write Review

**Responsibility.** Owns both the entry-point affordance (a button, which may be triggered from `Summary`, the Rating Badge, or a persistent CTA) and the submission modal itself — generalizing the toggle-button-plus-inline-form pattern already shipped in the current widget into the full modal treatment specified in `STOREFRONT_DESIGN_SYSTEM.md` §16.

**Props.** `productId` (for constructing the submission payload — same shape the existing `POST /api/reviews` already accepts, unchanged).

**State.** `formOpen: boolean`, `formValues: { rating, name, email, title, content }`, `submitStatus: 'idle' | 'submitting' | 'success' | 'error'`, `errorMessage`.

**Events.**
- Emits: `imagyn:review:submitted` with the created review's `{ id, status, createdAt }` on success (matching the existing `POST /api/reviews` response shape exactly). `ReviewsWidget` listens and may optimistically acknowledge the submission, but should **not** insert the new review into `Review List` — new reviews are created with `PENDING` status and won't appear publicly until a merchant approves them via the existing moderation flow. This is called out explicitly so the success state doesn't imply the review is immediately live, which would be inaccurate.

**This is the second component, besides Helpful, that talks to the network directly** — submission is a one-off write with its own success/error lifecycle, not something that flows through `ReviewsWidget`'s read-oriented data fetching.

**Responsive behaviour.** Centered floating modal on desktop; full-screen sheet on mobile (per `STOREFRONT_DESIGN_SYSTEM.md` §14/§16 — explicit, not optional). Focus trapped while open, focus returned to the triggering element on close, at every breakpoint.

---

## Summary of open backend dependencies

For honesty about what this architecture assumes exists versus what it requires building: `Summary`, `Histogram`, `Review List`, `Review Card`, `Media`, `Verified Badge`, `Pagination`, and `Write Review` all map directly to data already returned by the existing `GET`/`POST /api/reviews` endpoints — no new backend work is implied by their specs above. `Recommendation`, `AI Summary`, and `Helpful` each depend on backend capability that does not exist yet (product recommendations, AI summarization, a helpful-vote endpoint) and should be scoped as their own backend tasks before their frontend specs above are implemented.
