import type { LoaderFunctionArgs } from "react-router";
import { SURFACE_KEYS, type SurfaceKey } from "../services/appearance.shared";

// The Appearance admin page's live-preview target — a resource route (no default
// component, same pattern as api.reviews.tsx) so it bypasses root.tsx's full
// App-Bridge/Polaris document shell entirely: this renders inside an <iframe>, showing
// only fixed fixture markup using the REAL storefront component class names, styled by
// the REAL copied CSS (see scripts/copy-preview-assets.mjs), not a hand-rolled mock.
//
// Deliberately unauthenticated: this never reads real store/review data, only a fixed
// sample fixture, so there's nothing here worth gating behind a session token — and an
// authenticate.admin() redirect would break a same-tab <iframe src=...> navigation that
// isn't carrying App Bridge's session-token handshake.
//
// The parent Appearance page (app/routes/app.appearance.tsx) postMessages the merchant's
// unsaved draft AppearanceTokens into this frame on every field change; this frame's own
// copy of imagyn-appearance.js applies them — the exact same code path the real
// storefront uses, not a second preview implementation.
//
// Every fixture is tagged with the SurfaceKeys it belongs to, and the same message carries
// which surface the merchant is currently looking at, so the frame shows that surface's
// actual widgets instead of one generic stack. That matters because the global brand and a
// per-surface override are different things: previewing a Trust Badge override against a
// page of review cards taught the merchant nothing about what they were changing.

interface PreviewBlock {
  id: string;
  /** Shown above the block so the merchant knows which widget they are looking at. */
  label: string;
  /** Which surfaces render this block. "global" scope shows every block. */
  surfaces: SurfaceKey[];
  html: string;
}

const STARS_FULL = 5;

/** Mirrors ImagynShared.renderStars — per-star elements, so --imagyn-color-star-empty shows. */
function stars(rating: number): string {
  const full = Math.round(rating);
  let out = "";
  for (let i = 0; i < STARS_FULL; i++) {
    out += i < full ? '<span class="imagyn-star">&#9733;</span>' : '<span class="imagyn-star imagyn-star--empty">&#9734;</span>';
  }
  return out;
}

const VERIFIED_BADGE =
  '<span class="imagyn-review-card__verified">' +
  '<svg class="imagyn-review-card__verified-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
  '<circle cx="10" cy="10" r="10" fill="currentColor"></circle>' +
  '<path d="M6 10.4 8.7 13 14 7.5" stroke="var(--imagyn-color-surface, #fff)" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>' +
  "</svg>" +
  '<span class="imagyn-review-card__verified-label">Verified Buyer</span>' +
  "</span>";

const CERTIFIED_ICON =
  '<svg class="imagyn-trust-badge__certified-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M10 1.5 12.2 6l5 .7-3.6 3.5.85 5-4.45-2.35L5.55 15.2l.85-5L2.8 6.7 7.8 6z"></path>' +
  "</svg>";

const THUMBS_UP =
  '<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
const THUMBS_DOWN =
  '<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

// Deliberately uneven counts: a histogram track that has wrongly gone solid is then obvious
// at a glance, rather than every row looking "full" either way.
const HISTOGRAM_ROWS = [
  { stars: 5, count: 96, pct: 100 },
  { stars: 4, count: 21, pct: 22 },
  { stars: 3, count: 7, pct: 8 },
  { stars: 2, count: 3, pct: 4 },
  { stars: 1, count: 1, pct: 2 },
];

function histogram(starLabels: boolean): string {
  return (
    '<div class="imagyn-histogram' + (starLabels ? " imagyn-histogram--star-labels" : "") + '">' +
    HISTOGRAM_ROWS.map(
      (row) =>
        '<div class="imagyn-histogram__row">' +
        '<span class="imagyn-histogram__label' +
        (starLabels ? " imagyn-histogram__label--stars" : "") +
        '" aria-hidden="true">' +
        (starLabels ? stars(row.stars) : String(row.stars)) +
        "</span>" +
        '<span class="imagyn-histogram__track">' +
        '<span class="imagyn-histogram__fill" aria-hidden="true" style="--imagyn-histogram-fill: ' +
        row.pct +
        '%"></span>' +
        "</span>" +
        '<span class="imagyn-histogram__count">' +
        row.count +
        "</span>" +
        "</div>",
    ).join("") +
    "</div>"
  );
}

const SAMPLE_REVIEWS = [
  {
    name: "Ava Patel",
    date: "Jun 12, 2026",
    rating: 5,
    verified: true,
    title: "Elegant and surprisingly fast",
    body: "Setup took minutes and the storefront presentation feels much more premium than our previous reviews app.",
    helpful: 18,
    notHelpful: 0,
  },
  {
    name: "Marcus Lee",
    date: "Jun 3, 2026",
    rating: 5,
    verified: true,
    title: "Exactly as described",
    body: "Great quality and it arrived earlier than expected. Would order again without hesitation.",
    helpful: 9,
    notHelpful: 1,
  },
  {
    name: "Sofia Reyes",
    date: "May 28, 2026",
    rating: 4,
    verified: false,
    title: "Good value",
    body: "Does what it says. Packaging could be a little sturdier, but the product itself held up fine.",
    helpful: 4,
    notHelpful: 0,
  },
];

const reviewCardsHtml = SAMPLE_REVIEWS.map(
  (review) =>
    '<li class="imagyn-review-card">' +
    '<div class="imagyn-review-card__header">' +
    '<span class="imagyn-review-card__name">' +
    review.name +
    "</span>" +
    (review.verified ? VERIFIED_BADGE : "") +
    '<span class="imagyn-review-card__date">' +
    review.date +
    "</span>" +
    "</div>" +
    '<span class="imagyn-review-card__stars" aria-hidden="true">' +
    stars(review.rating) +
    "</span>" +
    '<p class="imagyn-review-card__title">' +
    review.title +
    "</p>" +
    '<p class="imagyn-review-card__body">' +
    review.body +
    "</p>" +
    '<div class="imagyn-review-card__footer">' +
    '<div class="imagyn-review-card__helpful">' +
    '<span class="imagyn-review-card__helpful-label">Was this helpful?</span>' +
    '<button type="button" class="imagyn-review-card__helpful-btn imagyn-review-card__helpful-btn--active">' +
    THUMBS_UP +
    "<span>" +
    review.helpful +
    "</span></button>" +
    '<button type="button" class="imagyn-review-card__helpful-btn">' +
    THUMBS_DOWN +
    "<span>" +
    review.notHelpful +
    "</span></button>" +
    "</div>" +
    "</div>" +
    "</li>",
).join("");

const READS_REVIEW_LIST: SurfaceKey[] = ["store_reviews", "product_reviews", "public_review_site"];

const BLOCKS: PreviewBlock[] = [
  {
    id: "rating-badge",
    label: "Rating badge — near the product title",
    surfaces: ["product_reviews"],
    html:
      '<span class="imagyn-card-badge">' +
      '<span class="imagyn-card-badge__stars" aria-hidden="true">' +
      stars(4.9) +
      "</span>" +
      '<span class="imagyn-card-badge__count">(128)</span>' +
      "</span>",
  },
  {
    id: "trust-badge",
    label: "Trust Badge",
    surfaces: ["trust_badge"],
    html:
      '<span class="imagyn-trust-badge-wrap imagyn-trust-badge-wrap--left">' +
      '<button type="button" class="imagyn-trust-badge" aria-haspopup="dialog">' +
      '<span class="imagyn-trust-badge__stars" aria-hidden="true">' +
      stars(4.8) +
      "</span>" +
      '<span class="imagyn-trust-badge__rating">4.8</span>' +
      '<span class="imagyn-trust-badge__count">(112 verified)</span>' +
      '<span class="imagyn-trust-badge__certified">' +
      CERTIFIED_ICON +
      "<span>Certified</span></span>" +
      "</button>" +
      "</span>",
  },
  {
    id: "summary",
    label: "Rating summary and breakdown",
    surfaces: READS_REVIEW_LIST,
    html:
      '<div class="imagyn-summary">' +
      '<div class="imagyn-summary__logo" aria-hidden="true"></div>' +
      '<div class="imagyn-summary__quickbar">' +
      '<span class="imagyn-summary__quickbar-stars" aria-hidden="true">' +
      stars(4.9) +
      "</span>" +
      '<span class="imagyn-summary__quickbar-rating">4.9</span>' +
      '<span class="imagyn-summary__quickbar-count">(128 reviews)</span>' +
      '<span class="imagyn-summary__quickbar-divider"></span>' +
      '<span class="imagyn-tag imagyn-tag--success">Verified</span>' +
      '<button type="button" class="imagyn-summary__quickbar-write">Write a review</button>' +
      "</div>" +
      histogram(true) +
      "</div>",
  },
  {
    id: "ai-summary",
    label: "AI Review Summary",
    surfaces: ["store_ai_summary", "product_reviews", "store_reviews"],
    html:
      '<div class="imagyn-ai-summary">' +
      '<p class="imagyn-ratings-section__label imagyn-ai-summary__heading">AI Review Summary</p>' +
      '<p class="imagyn-ai-summary__text">Customers consistently praise the fit and fabric quality, with several noting it runs slightly small.</p>' +
      '<p class="imagyn-ai-summary__recommendation">Based on 128 approved reviews</p>' +
      "</div>",
  },
  {
    id: "buttons",
    label: "Buttons",
    surfaces: [...READS_REVIEW_LIST, "review_request_landing"],
    html:
      '<div class="imagyn-preview-row">' +
      '<button type="button" class="imagyn-btn imagyn-btn--primary">Leave a review</button>' +
      '<button type="button" class="imagyn-btn">Load more</button>' +
      "</div>",
  },
  {
    id: "review-cards",
    label: "Review cards",
    surfaces: READS_REVIEW_LIST,
    html: '<ul class="imagyn-reviews__list imagyn-reviews--layout-list">' + reviewCardsHtml + "</ul>",
  },
  {
    id: "carousel",
    label: "Review Carousel",
    surfaces: ["review_carousel"],
    html:
      '<div class="imagyn-carousel">' +
      '<div class="imagyn-carousel__summary">' +
      '<span class="imagyn-carousel__summary-stars" aria-hidden="true">' +
      stars(4.9) +
      "</span>" +
      '<span class="imagyn-carousel__summary-score" aria-hidden="true">4.90</span>' +
      '<span class="imagyn-carousel__summary-count" aria-hidden="true">(128)</span>' +
      '<span class="imagyn-carousel__summary-badge"><span class="imagyn-carousel__summary-badge-label">Verified</span></span>' +
      "</div>" +
      '<div class="imagyn-carousel__viewport">' +
      '<ul class="imagyn-carousel__track">' +
      SAMPLE_REVIEWS.slice(0, 2)
        .map(
          (review) =>
            '<li class="imagyn-carousel__slide">' +
            '<div class="imagyn-carousel__content">' +
            '<div class="imagyn-carousel__text">' +
            '<p class="imagyn-review-card__title">' +
            review.title +
            "</p>" +
            '<p class="imagyn-review-card__body">' +
            review.body +
            "</p>" +
            '<span class="imagyn-review-card__stars" aria-hidden="true">' +
            stars(review.rating) +
            "</span>" +
            '<div class="imagyn-review-card__header">' +
            '<span class="imagyn-review-card__identity">' +
            '<span class="imagyn-review-card__name">' +
            review.name +
            "</span>" +
            (review.verified ? VERIFIED_BADGE : "") +
            "</span>" +
            '<span class="imagyn-review-card__date">' +
            review.date +
            "</span>" +
            "</div>" +
            "</div>" +
            "</div>" +
            "</li>",
        )
        .join("") +
      "</ul>" +
      "</div>" +
      '<div class="imagyn-carousel__controls">' +
      '<div class="imagyn-carousel__dots">' +
      '<span class="imagyn-carousel__dot imagyn-carousel__dot--active"></span>' +
      '<span class="imagyn-carousel__dot"></span>' +
      "</div>" +
      "</div>" +
      "</div>",
  },
  {
    id: "video-carousel",
    label: "Video Reviews Carousel",
    surfaces: ["video_reviews_carousel"],
    html:
      '<div class="imagyn-vcarousel" style="--imagyn-vcarousel-cards-desktop: 2; --imagyn-vcarousel-cards-tablet: 2; --imagyn-vcarousel-cards-mobile: 2; --imagyn-vcarousel-gap: 12px">' +
      '<div class="imagyn-vcarousel__header">' +
      '<h2 class="imagyn-vcarousel__heading">Video reviews</h2>' +
      '<p class="imagyn-vcarousel__subheading">Real customers, in their own words</p>' +
      "</div>" +
      '<div class="imagyn-vcarousel__viewport">' +
      '<ul class="imagyn-vcarousel__track">' +
      SAMPLE_REVIEWS.slice(0, 2)
        .map(
          (review) =>
            '<li class="imagyn-vcarousel__slide">' +
            '<article class="imagyn-vcarousel__card">' +
            '<div class="imagyn-vcarousel__media">' +
            '<button type="button" class="imagyn-vcarousel__play" aria-label="Play video review">' +
            '<span class="imagyn-vcarousel__play-icon" aria-hidden="true"></span>' +
            "</button>" +
            "</div>" +
            '<div class="imagyn-vcarousel__body">' +
            '<p class="imagyn-vcarousel__rating"><span aria-hidden="true">' +
            stars(review.rating) +
            "</span></p>" +
            '<p class="imagyn-vcarousel__text">' +
            review.body +
            "</p>" +
            '<p class="imagyn-vcarousel__meta">' +
            '<span class="imagyn-vcarousel__name">' +
            review.name +
            "</span>" +
            (review.verified ? '<span class="imagyn-vcarousel__verified">Verified Buyer</span>' : "") +
            "</p>" +
            '<p class="imagyn-vcarousel__product">' +
            '<span class="imagyn-vcarousel__product-name">Everyday Merino Crew</span>' +
            "</p>" +
            "</div>" +
            "</article>" +
            "</li>",
        )
        .join("") +
      "</ul>" +
      "</div>" +
      "</div>",
  },
  {
    id: "floating",
    label: "Floating Reviews — tab and panel",
    surfaces: ["floating_reviews"],
    html:
      '<div class="imagyn-preview-row imagyn-preview-row--floating">' +
      '<button type="button" class="imagyn-floating-reviews__tab imagyn-floating-reviews__tab--right">' +
      '<span class="imagyn-floating-reviews__tab-star" aria-hidden="true">&#9733;</span>' +
      '<span class="imagyn-floating-reviews__tab-rating">4.9</span>' +
      '<span class="imagyn-floating-reviews__tab-count">(128)</span>' +
      "</button>" +
      '<div class="imagyn-floating-reviews__panel imagyn-floating-reviews__panel--right">' +
      '<div class="imagyn-floating-reviews__header">' +
      '<div class="imagyn-floating-reviews__header-top">' +
      "<div>" +
      '<h2 class="imagyn-floating-reviews__title">Customer reviews</h2>' +
      '<p class="imagyn-floating-reviews__scope">Across the whole store</p>' +
      "</div>" +
      '<button type="button" class="imagyn-floating-reviews__close" aria-label="Close reviews">&times;</button>' +
      "</div>" +
      '<div class="imagyn-floating-reviews__summary">' +
      '<span class="imagyn-floating-reviews__average">4.9</span>' +
      '<span class="imagyn-floating-reviews__stars">' +
      stars(4.9) +
      "</span>" +
      '<span class="imagyn-floating-reviews__count">128 reviews</span>' +
      "</div>" +
      '<div class="imagyn-floating-reviews__distribution">' +
      histogram(true) +
      "</div>" +
      "</div>" +
      '<div class="imagyn-floating-reviews__body">' +
      '<ul class="imagyn-floating-reviews__list">' +
      SAMPLE_REVIEWS.slice(0, 2)
        .map(
          (review) =>
            '<li class="imagyn-floating-reviews__review">' +
            '<div class="imagyn-floating-reviews__review-head">' +
            '<span class="imagyn-floating-reviews__review-stars">' +
            stars(review.rating) +
            "</span>" +
            '<span class="imagyn-floating-reviews__review-author">' +
            review.name +
            "</span>" +
            "</div>" +
            '<p class="imagyn-floating-reviews__review-title">' +
            review.title +
            "</p>" +
            '<p class="imagyn-floating-reviews__review-body">' +
            review.body +
            "</p>" +
            "</li>",
        )
        .join("") +
      "</ul>" +
      "</div>" +
      '<div class="imagyn-floating-reviews__footer">' +
      '<button type="button" class="imagyn-floating-reviews__cta">Write a review</button>' +
      "</div>" +
      "</div>" +
      "</div>",
  },
];

// Every surface must have something to show, or the merchant selects one and sees an empty
// frame with no explanation. Asserted at render time rather than trusted.
const UNCOVERED_SURFACES = SURFACE_KEYS.filter(
  (key) => !BLOCKS.some((block) => block.surfaces.includes(key)),
);

export const loader = ({ request }: LoaderFunctionArgs) => {
  void request;

  const blocksHtml = BLOCKS.map(
    (block) =>
      `<section class="imagyn-preview-block" data-imagyn-preview-surfaces="${block.surfaces.join(" ")}">` +
      `<p class="imagyn-preview-label">${block.label}</p>` +
      `<div class="imagyn-preview-stage">${block.html}</div>` +
      "</section>",
  ).join("");

  const uncoveredHtml = UNCOVERED_SURFACES.map(
    (key) =>
      `<section class="imagyn-preview-block" data-imagyn-preview-surfaces="${key}">` +
      `<p class="imagyn-preview-label">${key}</p>` +
      '<p class="imagyn-preview-note">This surface has no preview fixture yet.</p>' +
      "</section>",
  ).join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/appearance-preview/imagyn-tokens.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-utilities.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-typography.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-badge.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-summary.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-histogram.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-ratings-section.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-review-card.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-button.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-tag.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-trust-badge.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-carousel.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-video-carousel.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-floating-reviews.css">
<style>
  body { margin: 0; padding: 20px; background: #fff; }
  .imagyn-preview-block { margin: 0 0 28px; max-width: 460px; }
  .imagyn-preview-block:last-child { margin-bottom: 0; }
  .imagyn-preview-label { font-family: Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(0,0,0,0.4); margin: 0 0 10px; }
  .imagyn-preview-note { font-family: Helvetica, Arial, sans-serif; font-size: 13px; color: rgba(0,0,0,0.5); margin: 0; }
  .imagyn-preview-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; }
  .imagyn-reviews--layout-list .imagyn-reviews__list { display: block; }
  .imagyn-reviews__list { margin: 0; padding: 0; }
  .imagyn-reviews__list li { list-style: none; }

  /* Preview-only LAYOUT concessions. Colour, radius, typography, borders and shadow still
     come entirely from the real component CSS and the real tokens — only positioning is
     neutralised, because these widgets are position:fixed/overflow-scrolled on a storefront
     and would otherwise pin themselves to the iframe edges or sit off-screen where the
     merchant cannot see the very thing they are editing. */
  .imagyn-preview-stage .imagyn-floating-reviews__tab,
  .imagyn-preview-stage .imagyn-floating-reviews__panel {
    position: static;
    transform: none;
    inset: auto;
    writing-mode: horizontal-tb;
  }
  .imagyn-preview-stage .imagyn-floating-reviews__panel {
    width: 300px;
    max-width: 100%;
    height: auto;
    max-height: none;
  }
  .imagyn-preview-row--floating { align-items: flex-start; }
  .imagyn-preview-stage .imagyn-carousel__slide { flex: 0 0 210px; }
  .imagyn-preview-stage .imagyn-vcarousel__media { min-height: 150px; }
</style>
</head>
<body data-imagyn-preview-scope="global">
  ${blocksHtml}
  ${uncoveredHtml}

  <script src="/appearance-preview/imagyn-appearance.js"></script>
  <script>
    // Show only the blocks belonging to the surface the merchant is inspecting. Driven by
    // the same message that carries the tokens, so the frame never shows one surface's
    // widgets wearing another surface's colours — and never reloads, so edits stay instant.
    function applyScope(scope) {
      var next = scope || "global";
      var blocks = document.querySelectorAll("[data-imagyn-preview-surfaces]");
      for (var i = 0; i < blocks.length; i++) {
        var surfaces = (blocks[i].getAttribute("data-imagyn-preview-surfaces") || "").split(" ");
        blocks[i].hidden = next !== "global" && surfaces.indexOf(next) === -1;
      }
      document.body.setAttribute("data-imagyn-preview-scope", next);
    }

    window.addEventListener("message", function (event) {
      if (!event.data || event.data.source !== "imagyn-appearance-draft") return;
      applyScope(event.data.scope);
      if (window.ImagynAppearance) {
        window.ImagynAppearance.apply(event.data.tokens);
      }
    });
  </script>
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
};
