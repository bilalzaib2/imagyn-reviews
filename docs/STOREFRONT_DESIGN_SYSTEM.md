# Imagyn Reviews — Storefront Design System

This is the single source of truth for every customer-facing Imagyn Reviews component: the Rating Badge, Collection Badges, Review Summary, Histogram, Recommendation section, AI Summary, Review Cards, Media Gallery, Filters, Write Review Modal, Helpful voting, Pagination, and skeleton loaders — plus everything built after this document.

It is a sibling to `11_DESIGN_SYSTEM.md`, not a replacement for it. `11_DESIGN_SYSTEM.md` governs the Imagyn admin dashboard, a surface we fully control. This document governs a surface we do not control: an arbitrary merchant's storefront, running an arbitrary theme, with our components injected into someone else's page. Every rule here is written with that constraint in mind. Where the two documents share a philosophy, this one restates it in storefront terms rather than assuming it.

No implementation code lives in this document. It defines what to build and why, not how to build it.

---

## 1. Design Philosophy

Imagyn Reviews should feel like it was designed by the same people who designed the store, not installed by them. The bar is not "looks nice for a review app" — it's "a merchant could not tell this wasn't built in-house."

We draw from five references, each for a different reason:

- **Apple** — precision. Every spacing value, every corner radius, every transition duration is a deliberate decision, not a default. Nothing arbitrary survives.
- **Linear** — simplicity through omission. The absence of a feature is a design decision as real as its presence. If a control doesn't earn its place, it doesn't ship.
- **Stripe Dashboard** — density without clutter. Real information (ratings, counts, distributions) presented tightly and legibly, never padded out to look more "designed."
- **Notion** — spacing as structure. Whitespace is not decoration; it's how hierarchy is communicated before a single word is read.
- **Atoms** — UX inspiration only, never visual cloning. Specifically: the discipline of showing one plain-language trust signal in the buy-box context instead of visual noise, and the separation of "the compact purchase-decision signal" from "the full review browsing experience" as two deliberately different surfaces rather than one bloated widget. We are not reusing Atoms' colors, type, or layout — we are reusing the *judgment* behind those decisions to build our own.

**What "premium" means here, concretely:** restraint. A premium review widget is not the one with the most stars, badges, and colors — it's the one a shopper doesn't consciously notice until they need it, and then finds exactly where they expect it.

**The standard for every component:** if you can't explain why a pixel value, a color, or a motion curve is what it is, it's wrong. There are no arbitrary values in this system.

---

## 2. Typography System

Typography is the primary design tool for every Imagyn Reviews component. Before adding a border, a background tint, or a shadow to create hierarchy, ask whether type size, weight, or spacing already solves it. It almost always does.

Text should never look like it's fighting the merchant's own theme typography for attention, and it should never look like an obviously foreign font transplanted into their page. The type system is quiet by design — legible, consistent, and self-effacing.

---

## 3. Typeface: System Font Stack

**Primary font, all Imagyn Reviews storefront components (and, identically, the Imagyn admin dashboard — see `11_DESIGN_SYSTEM.md`):**

```
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "SF Pro Display",
  "Helvetica Neue",
  Helvetica,
  Arial,
  sans-serif;
```

This is a permanent, deliberate decision, not a placeholder: Imagyn Reviews does not load any external font (no Adobe Fonts/Typekit, no Google Fonts, no self-hosted `@font-face`) on either surface. Two reasons converge on the same answer:

- **Storefront licensing:** a paid font kit (e.g. Adobe Fonts) is licensed to specific registered domains. Imagyn Reviews installs onto thousands of arbitrary, merchant-owned storefront domains we don't control — there is no domain to register the kit against. A system font stack has no licensing surface at all.
- **Design intent:** `-apple-system`/`BlinkMacSystemFont`/`SF Pro Display` render as San Francisco on Apple devices — the same typographic voice as Apple, Linear, and Notion (§1) — while `Helvetica Neue → Helvetica → Arial → sans-serif` degrade gracefully everywhere else. No network request, no flash of unstyled/invisible text, zero render-blocking risk.

Rules:

- This stack is applied **only** to elements carrying an Imagyn class. It is never applied globally (never on `body`, `html`, or any selector the merchant's own theme might also target). Scoping is enforced at the component level, not the page level.
- Do not add a merchant-theme font as a fallback step, even for "better visual matching." Our type identity should be consistent across every store we appear on. A shopper who sees Imagyn Reviews on two different stores should recognize the same typographic voice on both.
- Never hardcode this stack inside an individual component file — every component consumes it via `var(--imagyn-font-family, ...)`, defined once in `imagyn-tokens.css`. Changing the typeface system-wide should mean editing one token, not auditing every component.
- No component may introduce Adobe Fonts, Typekit, Google Fonts, or any other externally-loaded font, on either the storefront or the admin dashboard. This applies without exception.

---

## 4. Type Scale

Sizes are defined in **pixels, never `rem`**. This is a hard rule, not a preference: several Shopify themes (Dawn included) set `html { font-size: 62.5% }` so that `1rem = 10px` instead of the browser default of 16px. A component sized in `rem` silently shrinks or grows depending on the merchant's own root font-size convention — which defeats the entire purpose of a controlled type scale. `px` is the only unit that renders identically regardless of the host theme.

| Token | Size | Usage |
|---|---|---|
| `--imagyn-font-size-xs` | 12px | Metadata: dates, helpful-vote counts, pagination labels |
| `--imagyn-font-size-sm` | 13px | Badge text, filter labels, secondary UI text |
| `--imagyn-font-size-base` | 15px | Review body text, form field text |
| `--imagyn-font-size-md` | 17px | Review card reviewer name, section labels |
| `--imagyn-font-size-lg` | 20px | Review Summary average-rating number, modal title |
| `--imagyn-font-size-xl` | 26px | Review Summary's hero average-rating numeral |

**Weight** — three steps only, matching `11_DESIGN_SYSTEM.md`'s restraint principle:

| Token | Weight | Usage |
|---|---|---|
| `--imagyn-font-weight-regular` | 400 | Body copy, review content |
| `--imagyn-font-weight-medium` | 500 | Badges, labels, reviewer names, buttons |
| `--imagyn-font-weight-semibold` | 600 | Section headings, the summary rating number |

Never use a weight outside these three. Never use `bold` (browser default 700) — it reads as heavier and less considered than a deliberate 600.

**Letter spacing** — two steps:

| Token | Value | Usage |
|---|---|---|
| `--imagyn-letter-spacing-tight` | 0.01em | Default for all UI text |
| `--imagyn-letter-spacing-normal` | 0.02em | Star icon rows, small uppercase labels |

**Line height** — two steps:

| Token | Value | Usage |
|---|---|---|
| `--imagyn-line-height-tight` | 1 | Single-line elements: badges, buttons, labels |
| `--imagyn-line-height-base` | 1.5 | Multi-line elements: review body text, descriptions |

---

## 5. Spacing Scale

Two parallel scales, used for different contexts — this distinction matters and should not be collapsed into one.

**Relative scale (`em`)** — for spacing *within* a single component, where the gap should scale with that component's own font-size (a badge's internal gap should shrink if the badge text shrinks):

| Token | Value |
|---|---|
| `--imagyn-space-3xs` | 0.2em |
| `--imagyn-space-2xs` | 0.3em |
| `--imagyn-space-xs` | 0.4em |
| `--imagyn-space-sm` | 0.6em |
| `--imagyn-space-md` | 1em |
| `--imagyn-space-lg` | 1.5em |
| `--imagyn-space-xl` | 2.5em |

**Absolute scale (`px`)** — for spacing *between* components or within standalone surfaces (modal padding, card padding, section gaps) where the gap must stay visually consistent regardless of local font-size:

| Token | Value |
|---|---|
| `--imagyn-space-px-xs` | 8px |
| `--imagyn-space-px-sm` | 12px |
| `--imagyn-space-px-md` | 16px |
| `--imagyn-space-px-lg` | 24px |
| `--imagyn-space-px-xl` | 40px |

Guidance, matching `11_DESIGN_SYSTEM.md`'s spacing rules: compact inline elements use 8–12px; standard component spacing uses 16–24px; separation between major sections (e.g., Review Summary from the Review Card list) uses 24–40px.

---

## 6. Radius Scale

| Token | Value | Usage |
|---|---|---|
| `--imagyn-radius-sm` | 4px | Filter chips, small inputs |
| `--imagyn-radius-md` | 8px | Review cards, buttons |
| `--imagyn-radius-lg` | 12px | Write Review Modal, media gallery lightbox |
| `--imagyn-radius-full` | 999px | Pills: rating badges (if a pill treatment is used), avatar circles |

Rating Badge and Collection Badges are inline text elements and take no radius at all by default (no background, no pill) — see §16.

---

## 7. Color Tokens

Color exists to support legibility, hierarchy, and state — never decoration. The system defaults to neutral, inheriting `currentColor` wherever possible so components sit naturally inside whatever color scheme the merchant's theme section already establishes, rather than imposing our own palette on top of theirs.

| Token | Value | Usage |
|---|---|---|
| `--imagyn-color-text` | `currentColor` | Primary text — inherits the merchant's own text color |
| `--imagyn-color-text-muted-opacity` | 0.6 | Applied as `opacity`, not a separate gray, so muted text always stays legible against whatever background color the section has |
| `--imagyn-color-star` | `#f5a623` | Filled star — the one deliberate brand accent color in the entire system |
| `--imagyn-color-star-empty` | `rgba(0, 0, 0, 0.15)` | Empty star outline |
| `--imagyn-color-border` | `rgba(0, 0, 0, 0.08)` | Hairline dividers |
| `--imagyn-color-surface` | `#ffffff` | Card/modal background — only used where a component must visually separate from the page (see §9) |
| `--imagyn-color-success` | `#1a7f4b` | Verified-purchase indicator, positive helpful-vote state |
| `--imagyn-color-danger` | `#c0392b` | Form validation errors only — never used decoratively |
| `--imagyn-color-focus` | `#2563eb` | Focus ring — see §13 |

Star yellow and the two semantic colors (success/danger) are the **only** non-neutral colors in the entire system. Do not introduce a secondary accent color for a new component without a specific, defensible reason.

---

## 8. Shadows

| Token | Value | Usage |
|---|---|---|
| `--imagyn-shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Review cards, filter dropdown |
| `--imagyn-shadow-md` | `0 2px 8px rgba(0,0,0,0.06)` | Write Review Modal, media lightbox |

Rules:

- Shadows are reserved for surfaces that visually lift off the page — modals, dropdowns, lightboxes. Inline elements (badges, buttons, form fields) never carry a shadow.
- Never stack both a shadow and a heavy border on the same element — pick one method of separation, per `11_DESIGN_SYSTEM.md`'s "depth comes from layout first" principle.
- No shadow in this system exceeds 8px of blur. Anything larger reads as dated skeuomorphism, not elevation.

---

## 9. Borders

Default to **no border**. A border is the second choice after whitespace and background contrast, not the first tool reached for.

- Hairline only: `1px solid var(--imagyn-color-border)` (`rgba(0,0,0,0.08)`). Never a darker or thicker border anywhere in this system.
- Used for: review card dividers in a dense list, filter chip outlines, form field outlines.
- Never used for: the badge, the summary line, pagination controls (these separate via spacing alone).

---

## 10. Motion Principles

Motion communicates state change. It never exists to be noticed on its own.

| Token | Value | Usage |
|---|---|---|
| `--imagyn-duration-fast` | 120ms | Hover/focus feedback, helpful-vote toggle |
| `--imagyn-duration-base` | 200ms | Filter panel open/close, tooltip appearance |
| `--imagyn-duration-slow` | 320ms | Write Review Modal open/close, media lightbox transition |
| `--imagyn-easing` | `cubic-bezier(0.22, 1, 0.36, 1)` | The single easing curve used everywhere — an ease-out; motion decelerates into its resting state, never overshoots, never bounces |

Rules:

- One easing curve for the whole system. Do not introduce a second curve for a "special" component.
- No animation on page load. Components should appear in their resolved state, not animate into existence, with the sole exception of skeleton-to-content transitions (§11), which cross-fade rather than slide or scale — implemented once, as the reusable `.imagyn-fade-in` utility, rather than per component. Review Summary's histogram bars growing from 0 to their target width the moment real content replaces the skeleton is part of this same exception, not a separate on-load animation.
- Hover feedback on a non-interactive element (e.g. a Histogram row) is allowed as a purely decorative, mouse-only cue — it must never imply an affordance that isn't there (no cursor change beyond default, no new focus/keyboard behavior, no ARIA role). The moment an element gains real interactivity (e.g. Histogram rows becoming rating-filter shortcuts), it inherits the Filters component's full hover/focus/keyboard treatment instead of this decorative-only one.
- Always respect `prefers-reduced-motion: reduce` — every transition in this system must have a reduced-motion variant that either removes the animation entirely or reduces it to an instant state change. This is not optional per component; it is enforced at the token level so no component can ship without it.
- Loading spinners are a last resort, not a default. See §11.

---

## 11. Loading States

Skeletons, not spinners, are the default loading treatment for every component that renders real content (Review Summary, Histogram, Review Cards, Media Gallery). A spinner communicates "something is happening, wait" — a skeleton communicates "this is what's about to appear," which is calmer and reduces perceived wait time.

Rules:

- Skeleton shapes should approximate the real content's actual layout (a review card skeleton has a name-width bar, a shorter meta-width bar, and 2–3 body-width bars) — not a generic gray box.
- Skeleton shimmer, if used, must be extremely subtle (a slow, low-contrast gradient sweep, never a bright flash) and must respect `prefers-reduced-motion` by becoming a static muted fill.
- A spinner is acceptable only for a genuinely indeterminate, short, user-triggered action with no meaningful content shape to preview — e.g., the Write Review Modal's submit button while the request is in flight. It is never used for initial content load.
- No component should show a loading state for longer than necessary to make one batched request. If a component's data isn't ready before the shopper can plausibly interact with it, that's a performance problem to fix upstream, not a loading-state design problem to paper over.

---

## 12. Empty States

Calm, quiet, never promotional. An empty state is information, not an opportunity for marketing copy.

- One line of plain-language explanation. No decorative illustration by default — illustrations are added only if they measurably improve comprehension, never for visual filler.
- The Rating Badge and Collection Badges render **nothing at all** when there are zero reviews — not an empty state, not a "no reviews yet" label, true absence. A badge that says "0 reviews" or hides behind muted styling still occupies visual weight it hasn't earned; the correct treatment is to not exist.
- Review Summary and Review Cards, which are deliberately-visited surfaces (not passively-encountered ones like a badge in a grid), do show a one-line empty state: quiet, muted-opacity text, no border or background treatment around it.
- Never block the Write Review action behind an empty state. A store with zero reviews should make writing the first one feel like an invitation, not a fallback — the "Write a Review" affordance stays fully present regardless of review count.

---

## 13. Accessibility

Accessibility is a floor, not a stretch goal, for every component in this document.

- **Contrast:** all text must meet WCAG AA (4.5:1 for body text, 3:1 for large text ≥ 24px or 19px bold). Because `--imagyn-color-text` inherits `currentColor`, contrast is technically the merchant theme's responsibility for the base color — but any Imagyn-authored override (muted opacity, star color against its background) must independently verify AA against both light and dark section backgrounds.
- **Focus states:** every interactive element (filter chips, pagination controls, helpful-vote button, modal close button, form fields) gets a visible focus ring using `--imagyn-color-focus`, never `outline: none` without a replacement. The ring must be visible against both light and dark surfaces.
- **Keyboard:** every interactive component must be fully operable by keyboard alone — filters, pagination, the Write Review Modal (including a working focus trap while open and focus return to the trigger on close), and media gallery navigation.
- **Screen readers:** star ratings are never conveyed by icon alone — always paired with a text equivalent ("4.8 out of 5", not just visual stars) via `aria-label` or visually-hidden text. Decorative star glyphs themselves are `aria-hidden="true"`.
- **Color is never the only signal.** Verified-purchase, helpful-vote-active, and validation-error states must each be distinguishable without color (icon, text label, or both).
- **Reduced motion:** covered in §10 — not optional, enforced systemically.

---

## 14. Mobile Behaviour

The majority of storefront traffic is mobile. Nothing in this system is "desktop-first, adapted for mobile" — every component is specified mobile-first.

- **Touch targets:** minimum 44×44px for any tappable control (helpful-vote button, pagination arrows, filter chips, modal close), even where the visible content is smaller — expand the hit area via padding, not by making the visible element itself larger than the type scale calls for.
- **Write Review Modal** becomes a full-screen sheet on mobile (not a centered floating modal) — this matches how shoppers already expect forms to behave on their device, not how they behave on desktop.
- **Media Gallery** uses native horizontal swipe/scroll on mobile rather than button-driven pagination as the primary interaction; buttons remain present for accessibility but are secondary.
- **Filters** collapse into a single "Filter" trigger that opens a bottom sheet on mobile, rather than displaying an inline filter bar that consumes vertical space above the content shoppers came to see.
- **Collection Badges** must never cause layout shift on mobile grids — reserve the badge's line height in the card layout before content arrives, rather than pushing content down when the badge appears (a direct, hard-won lesson from this system's own implementation history).

---

## 15. Component Hierarchy

How these components relate to one another, top to bottom, on a product page:

```
Product Page
├── Rating Badge (beside/near the product title — compact, single-line trust signal)
│
├── Review Summary (further down the page, its own section)
│   ├── Average rating (large numeral, --imagyn-font-size-lg, semibold)
│   ├── Review count
│   ├── Histogram (5-star distribution bars)
│   └── AI Summary (short synthesized text, clearly labeled as AI-generated)
│
├── Filters (governs the Review Cards list below it)
│
├── Review Cards (list)
│   ├── Reviewer name + verified badge
│   ├── Star rating
│   ├── Review title + body
│   ├── Media Gallery (if photos/video attached)
│   └── Helpful voting
│
├── Pagination (governs the Review Cards list)
│
└── Write Review Modal (triggered from Rating Badge, Review Summary, or a persistent CTA — not a separate page)
```

Elsewhere on the storefront, independent of a single product page:

```
Collection Grid / Search Results / Featured Collection / Related Products
└── Collection Badge (one per product card, beneath the title — same visual
    component as the Rating Badge, different injection context)
```

The Rating Badge and Collection Badges are the same design *component* used in two different *contexts* — they must share one visual definition (per the existing implementation's `imagyn-component-badge.css` approach) rather than drift into two similar-but-different badges over time.

---

## 16. Component Visual Rules

### Rating Badge

The compact, single-line trust signal near the buy box — not the full review browsing experience (that's Review Summary, further down the page). Inline text only: no background, no border, no pill shape, no shadow. Stars at `--imagyn-font-size-sm` scaled to 0.9em within the badge (a deliberately quiet accent, not a competing element — see the existing `imagyn-component-badge.css` for the shipped version of this rule), count text at full badge size and `--imagyn-color-text-muted-opacity`. Renders nothing when zero reviews (§12).

### Review Summary

The visual hero of the widget — the first full-detail surface a shopper reaches. Average rating as a large numeral (`--imagyn-font-size-xl`, semibold, tabular-nums), with a compact accent star row and the review count stacked beside it (small, muted opacity) — the same quiet, scaled-down star treatment already established for the Rating Badge, not a competing element. A recommendation-percentage line ("N% of customers recommend this product", derived from the 4–5 star share of `ratingCounts`, `--imagyn-color-success`) sits beneath the headline. The Histogram anchors the bottom of the component. Generous vertical spacing (`--imagyn-space-px-lg`) separates the whole component from both the Rating Badge above and the Filters/Review Cards below — this is a section break, not a continuation.

Screen-reader text is a single visually-hidden sentence covering the numeral, star rating, review count, and recommendation percentage; the equivalent visual elements are `aria-hidden`. Zero reviews renders the Empty State component instead (§12) — one quiet muted-opacity line, no histogram, no recommendation stat. While the summary is loading, a skeleton (§11) sized to the hero's real proportions (numeral block, meta line, five histogram-width bars) renders synchronously before the network response arrives, replaced in place once data resolves.

### Histogram

Five horizontal bars (5-star to 1-star), each a label + bar + count, using `--imagyn-color-star` at reduced opacity for the fill and `--imagyn-color-border` for the track. Bars are proportional to the largest count, not to a fixed 100% scale, so a store with mostly 5-star reviews shows a visually confident chart rather than five nearly-empty bars. Each row's numeral label, bar, and count are `aria-hidden`; a per-row visually-hidden sentence ("5 stars: 84 reviews") carries the equivalent text so the distribution is available to screen readers without duplicating the top-level summary sentence. No interactivity in this phase; each bar becomes a rating filter shortcut in a later iteration, at which point it inherits the Filters component's focus/hover treatment.

### Recommendation section

("Customers also mention…" / cross-sell context, not to be confused with Related Products, which is a Shopify-native surface Collection Badges also appear on.) Treated as its own card-based row, visually consistent with Review Cards but condensed — title + rating only, no full body text. Horizontal scroll on mobile, matching Media Gallery's swipe pattern rather than inventing a third scroll interaction.

### AI Summary

Must be visually and textually distinguishable from a human review at all times — a small, explicit "Summary" or "AI Summary" label (`--imagyn-font-size-xs`, medium weight, muted) is non-negotiable, positioned directly above the synthesized text. No sparkle icons, gradients, or "AI-flavored" decorative treatment — the distinction is made through a clear text label, not a visual gimmick, consistent with the system's overall restraint. Sits directly beneath the Histogram, above Filters.

### Review Cards

The density reference point for the whole system: real content, tight but legible, per §1's Stripe Dashboard influence. Reviewer name at `--imagyn-font-size-md` medium weight, star rating beside it, date at `--imagyn-font-size-xs` muted, review title semibold, body at `--imagyn-font-size-base` regular with `--imagyn-line-height-base`. Cards separate via a hairline border (§9) or `--imagyn-space-px-md` of whitespace — pick one per implementation, never both. Verified-purchase indicator uses `--imagyn-color-success` plus a text label, never a color-only badge (§13).

### Media Gallery

Thumbnail row beneath review body text when present; tapping/clicking opens a lightweight lightbox (`--imagyn-radius-lg`, `--imagyn-shadow-md`) rather than navigating away. Lightbox transition uses `--imagyn-duration-slow`. Full keyboard operability required: arrow keys to navigate, Escape to close, focus trapped while open.

### Filters

Chip-based, not a form. Each active filter is a pill (`--imagyn-radius-full`) with a clear remove affordance. Collapses to a bottom-sheet trigger on mobile (§14). Filter state changes never cause a full page reload — the Review Cards list and Pagination update in place.

### Write Review Modal

Centered floating modal on desktop, full-screen sheet on mobile (§14). `--imagyn-radius-lg`, `--imagyn-shadow-md`. Star rating input first (largest touch targets in the entire system — these are the primary input), then name, then optional email, then title, then body — matching the field order already shipped in the current inline form. Submit button shows a spinner (the one sanctioned spinner use case, §11) while in flight, disabled state during submission, success confirmation replaces the form rather than appearing as a toast (so the shopper has clear, persistent confirmation their review was received).

### Helpful voting

A single button, icon + count, `--imagyn-duration-fast` transition on toggle. Active state uses `--imagyn-color-success` plus a filled icon variant — never color alone. No running tally animation or celebratory motion; the count simply updates.

### Pagination

Prefer "Load more" over numbered pages for the primary Review Cards list — it matches the collection-grid pattern shoppers already know from the storefront itself, and avoids a full re-render/scroll-position jump. Numbered pagination is reserved for a future dedicated "all reviews" surface where jumping to a specific page has real value. Buttons meet the 44×44px touch target minimum (§14) regardless of visual size.

### Skeleton loaders

One skeleton shape per component that renders real content (§11): Review Summary, Histogram, Review Cards, Media Gallery. Each approximates its real layout's proportions. No skeleton for the Rating Badge or Collection Badges — these either resolve near-instantly from the batched request or render nothing (§12), so a skeleton would itself become the layout-shift problem §14 warns against.

---

## Implementation Constraints Worth Repeating Here

These aren't design rules, but they materially affect how every rule above can actually be built, and were each discovered the hard way during this project's build-out:

- Shopify theme app extensions serve the `assets/` folder **flat** — no confirmed subdirectory support. Component file organization uses naming conventions (`imagyn-component-*.css`), not folders.
- Font-size and spacing tokens must use `px`/`em`, never `rem` — merchant themes may redefine the root font-size (§4).
- Every visible component must be idempotent against being injected more than once into the same DOM node — dynamic Shopify sections (sliders, AJAX-loaded collections, predictive search) can trigger re-scans.
- Nothing in this system may visually or functionally depend on the merchant's own theme CSS being any particular way — components must look correct in isolation.
