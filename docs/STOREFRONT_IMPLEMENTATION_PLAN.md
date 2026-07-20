# Imagyn Reviews — Storefront Implementation Plan

This breaks `STOREFRONT_ARCHITECTURE.md`'s component tree into small, independently deployable phases. No code is written here — this is a sequencing and scoping document.

**A note on where we're actually starting from.** This isn't a greenfield build. A working Reviews Widget already ships today (`star_rating.liquid` / `reviews-widget.js`) with a review list, an inline write-review form, verified-purchase display, and photo thumbnails — just not organized into the component architecture or styled with the token system `STOREFRONT_DESIGN_SYSTEM.md` defines. Phase 1 below accounts for that migration explicitly, rather than pretending we're building `Review List` and `Review Card` from nothing. Treating that as free would make every later estimate wrong.

---

## Complexity scale

T-shirt sizes, not hour estimates — precise time estimates for anything touching a new backend capability or an external dependency (AI, recommendations) would be false confidence.

| Size | Meaning |
|---|---|
| **XS** | Near-trivial. Extracting/reformatting something that already exists and works. |
| **S** | A day or two. One component, data already available, no new backend endpoint. |
| **M** | Several days. Either a new frontend interaction pattern, or a small, well-scoped backend addition. |
| **L** | A week-plus. New backend capability with real design decisions to make (data model, anti-abuse, caching). |
| **XL** | Genuinely open-ended. External API dependency, cost implications, or quality/output risk that can't be scoped tightly up front. |

---

## Dependency graph

```
Phase 1 (Foundation)
  └── everything else depends on this — it's the root component all others mount inside

Phase 1 → Phase 2 (Verified Badge)
Phase 1 → Phase 3 (Summary)
Phase 1 → Phase 4 (Pagination)
Phase 1 → Phase 5 (Media + lightbox)
Phase 1 + small backend addition → Phase 6 (Histogram)
Phase 1 + backend query params → Phase 7 (Filters)
Phase 1 + new backend → Phase 8 (Helpful)
Phase 5 (shares the lightbox) → Phase 9 (Gallery)
Phase 1 → Phase 10 (Write Review modal upgrade)
Phase 1 + Shopify's native recommendations → Phase 11 (Recommendation)
Phase 1 + new AI pipeline → Phase 12 (AI Summary)
```

Only Phase 1 is a hard blocker for everything. Phases 2–11 are independent of *each other* once Phase 1 ships — they can be built and deployed in any order, or in parallel by different people, except where noted (Phase 9 reuses Phase 5's lightbox).

---

## Phase 1 — Foundation & Component Shell

**Scope.** Migrate the existing widget's logic into the `ReviewsWidget` root + `Review List` + `Review Card` structure from `STOREFRONT_ARCHITECTURE.md`, applying `STOREFRONT_DESIGN_SYSTEM.md`'s typography and spacing tokens throughout. No new user-facing capability — this phase should be visually and functionally unremarkable to a shopper. What changes is entirely internal: the code now has real component boundaries and a shared token system instead of one flat script.

**Complexity.** M. It's a real refactor — extracting `Review Card`'s rendering into its own function/module, formalizing the props/state/events boundaries the architecture doc defines, wiring the event-bubbling convention — but touches no new backend, no new interaction design, no new data.

**Dependencies.** None. This is the root everything else attaches to.

**Deployable outcome.** The existing widget, working exactly as it does today, now living inside the new architecture. A shopper notices nothing different except (ideally) tighter, more consistent typography from the token system.

---

## Phase 2 — Verified Badge

**Scope.** Extract the already-shipped verified-purchase indicator into its own component per the architecture spec (`verified: boolean` prop, renders nothing when false).

**Complexity.** XS. This already exists inline in the current widget; this phase is pure extraction plus applying `--imagyn-color-success` and the token-based text treatment.

**Dependencies.** Phase 1.

**Deployable outcome.** Same visual result as today, now a real reusable component.

---

## Phase 3 — Review Summary

**Scope.** Formalize the average-rating-and-count display as its own `Summary` component, positioned per the architecture doc, using `--imagyn-font-size-lg` semibold for the numeral.

**Complexity.** S. Data already exists (`GET /api/reviews`'s existing `summary` field) — this is a new component around existing data, not a new data requirement.

**Dependencies.** Phase 1.

**Deployable outcome.** A visually distinct, more prominent summary section than today's inline version — the first real, noticeable design upgrade in this plan.

---

## Phase 4 — Pagination

**Scope.** Replace the current Prev/Next (replace-the-list) pagination with "Load more" (append-to-the-list) behavior, per `STOREFRONT_DESIGN_SYSTEM.md` §16's explicit preference.

**Complexity.** S/M. This is a real behavior change, not just a relabel — appending preserves scroll position and previously-rendered cards, which the current replace-based approach doesn't attempt to do.

**Dependencies.** Phase 1.

**Deployable outcome.** Smoother, more familiar (collection-grid-like) review browsing — a genuine UX improvement, cheap to ship.

---

## Phase 5 — Media (per-review) + Lightbox

**Scope.** Upgrade the existing static photo-thumbnail grid into the `Media` component with a real lightbox (per `STOREFRONT_DESIGN_SYSTEM.md` §16: keyboard navigation, focus trap, `--imagyn-duration-slow` transition).

**Complexity.** M. The thumbnails already exist; the lightbox itself (open/close, arrow-key navigation, focus management, Escape-to-close) is new, real interaction work and the part of this phase most likely to reveal edge cases (e.g. a review with one photo vs. many, video vs. image).

**Dependencies.** Phase 1.

**Deployable outcome.** Clicking a review photo opens a proper lightbox instead of just linking to the raw image — a visible, tangible upgrade.

---

## Phase 6 — Histogram

**Scope.** New `Histogram` component rendering the 5-star distribution as proportional bars.

**Complexity.** S/M. This looks like it needs new backend infrastructure but doesn't, quite — `Product.rating5Count`…`rating1Count` already exist in the schema, denormalized by the existing `recalculateProductStats`. The catch: those counts include every review status, not just `APPROVED`, so they can't be read directly for public display (same reason `getPublicReviewSummary` computes its own APPROVED-only average rather than reading `Product.averageRating`). The backend work here is a small, well-precedented extension: add an APPROVED-scoped per-rating `groupBy` to `getPublicReviewSummary`, following the exact pattern `getPublicReviewSummaryBatch` already uses. Not a new capability — the same query shape, applied one level deeper.

**Dependencies.** Phase 1, plus that small backend addition.

**Deployable outcome.** A real, currently-missing piece of social proof — the distribution bars establish trust in a way a single average number doesn't.

---

## Phase 7 — Filters

**Scope.** New `Filters` component (rating, verified-purchase, sort), wired to a `Filters`-driven re-fetch that replaces `Review List`'s contents.

**Complexity.** M. The hard part isn't the frontend — it's that the public `GET /api/reviews` endpoint currently accepts no filter parameters at all (only `productId`). The internal `queryReviews`/`ReviewQueryOptions` machinery already supports exactly this filtering shape on the admin side; this phase is about deliberately, carefully exposing a safe subset of it publicly (rating, verified-purchase, sort — not the admin's full search/date-range surface, which isn't relevant to a shopper and shouldn't be exposed) rather than building new filtering logic from scratch.

**Dependencies.** Phase 1, plus extending the public endpoint's accepted query parameters.

**Deployable outcome.** Shoppers can narrow reviews by rating and verified-purchase status — a widely-expected feature on any modern review widget, currently absent.

---

## Phase 8 — Helpful voting

**Scope.** New `Helpful` component plus a new vote endpoint.

**Complexity.** L. This is the first phase with a real, un-precedented design decision to make before building anything: how to prevent one visitor voting the same review helpful repeatedly. The architecture doc's stated v1 approach (local-storage-only dedup, no customer accounts) is honest about its limits — it stops accidental double-clicks, not deliberate abuse. That's an acceptable v1 tradeoff, but it's a real product decision, not just an implementation detail, and should be confirmed before building rather than assumed.

**Dependencies.** Phase 1. Independent of every other phase.

**Deployable outcome.** A functioning helpful-vote button — genuinely new capability, not a redesign of something existing.

---

## Phase 9 — Gallery (aggregated media)

**Scope.** New `Gallery` component showing all photos across all reviews for a product, reusing Phase 5's lightbox.

**Complexity.** S if scoped to only the media already present in the currently-loaded page of reviews (zero new backend calls — `Gallery` simply collects `photoUrls` across whatever `Review List` already has in memory). **L** if scoped to show *every* photo ever submitted for the product regardless of pagination, which requires a new aggregation endpoint. **Recommendation: ship the S version first.** A shopper is very unlikely to notice or mind that the gallery reflects "photos from reviews loaded so far" rather than the entire history, and the L version can be added later without changing `Gallery`'s props contract at all — only its data source.

**Dependencies.** Phase 1, and reuses Phase 5's lightbox rather than building a second one.

**Deployable outcome.** A single browsable strip of customer photos at the top of the reviews section — a strong, visible trust signal for very low effort if scoped as recommended.

---

## Phase 10 — Write Review Modal upgrade

**Scope.** Upgrade the existing inline toggle-form into the full modal treatment `STOREFRONT_DESIGN_SYSTEM.md` §16 specifies: centered floating modal on desktop, full-screen sheet on mobile, proper focus trap.

**Complexity.** M. The form logic and submission endpoint are unchanged and already working — this phase is specifically about the modal *shell* (positioning, backdrop, focus trap, mobile sheet behavior, open/close transitions), which is real, accessibility-sensitive work even though no new data or validation logic is involved.

**Dependencies.** Phase 1.

**Deployable outcome.** A noticeably more polished submission experience, particularly on mobile, where "full-screen sheet" is a meaningfully better pattern than a small floating modal.

---

## Phase 11 — Recommendation

**Scope.** New `Recommendation` component ("customers also mention…").

**Complexity.** M if it reuses Shopify's own native product-recommendations mechanism (the same API Dawn's own "related products" section already calls) merged with our own rating data for display — **this is the recommended scope.** Building a custom recommendation algorithm instead would be **XL** and is not justified by what this component actually needs to do (surface a handful of plausible related products with their ratings, not out-innovate Shopify's own recommendation engine).

**Dependencies.** Phase 1, plus a small backend addition to fetch rating data for whatever product IDs Shopify's recommendation API returns (this can reuse the existing batch-summary endpoint almost as-is).

**Deployable outcome.** A cross-sell row that also functions as social proof for the recommended products, not just a bare product grid.

---

## Phase 12 — AI Summary

**Scope.** New `AI Summary` component, backed by a genuinely new backend pipeline: selecting review text to summarize, calling an LLM, caching the result, deciding a regeneration policy (on a schedule? on new-review-count thresholds?), and handling generation failure gracefully (render nothing, per the architecture doc, never a broken block).

**Complexity.** XL, deliberately not sized more precisely. This is the one phase in this plan with real external-dependency risk: API cost per generation, latency, output quality/moderation (a bad or inaccurate AI summary is worse than no summary), and a caching/regeneration strategy that has genuine design tradeoffs. It should not be scoped or estimated further until those questions have answers — attaching a fake day-estimate to it now would be worse than leaving it as "large and open."

**Dependencies.** Phase 1. Entirely independent of every other phase — could be built whenever, but shouldn't be scheduled early given its uncertainty relative to everything else in this plan.

**Deployable outcome.** A synthesized review summary — the single most differentiated feature in this plan, and the one most worth *not* rushing.

---

## Recommended build order

Your example numbered Summary → Histogram → Review Cards → Filters as an illustration of the phase format, not a mandated sequence — this is the order I'd actually recommend, reasoned from dependency + effort/value ratio + risk, cheapest and most certain first:

1. **Foundation & Component Shell** — blocks everything, so it goes first regardless of anything else.
2. **Verified Badge** — trivial, ships same day as Phase 1 realistically.
3. **Review Summary** — small, immediately visible improvement.
4. **Pagination (Load more)** — small, fixes a real current UX gap.
5. **Histogram** — small backend extension, high trust-signal value.
6. **Media + lightbox** — medium, high visual payoff.
7. **Gallery** (scoped to loaded-page media) — small once Phase 6's lightbox exists, strong visible payoff for the effort.
8. **Write Review Modal upgrade** — medium, meaningfully better mobile experience.
9. **Filters** — medium, exposes existing backend query capability publicly for the first time.
10. **Helpful voting** — large, first phase needing a real anti-abuse decision made before building.
11. **Recommendation** — medium if built on Shopify's native recommendation API as recommended above.
12. **AI Summary** — largest and least certain; last on purpose, not as an afterthought.

Everything from Phase 2 onward is independently deployable in isolation once Phase 1 ships — this order optimizes for shipping value early and pushing the two open-ended, infrastructure-heavy phases (Helpful's anti-abuse design, AI Summary's whole pipeline) to the end, not for matching the component tree's original left-to-right order.
