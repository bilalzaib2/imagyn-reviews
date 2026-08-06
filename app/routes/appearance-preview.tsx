import type { LoaderFunctionArgs } from "react-router";

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
export const loader = ({ request }: LoaderFunctionArgs) => {
  void request;

  const THUMBS_UP =
    '<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  const THUMBS_DOWN =
    '<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

  const SAMPLE_REVIEWS = [
    {
      name: "Ava Patel",
      date: "Jun 12, 2026",
      verified: true,
      title: "Elegant and surprisingly fast",
      body: "Setup took minutes and the storefront presentation feels much more premium than our previous reviews app.",
      helpful: 18,
      notHelpful: 0,
    },
    {
      name: "Marcus Lee",
      date: "Jun 3, 2026",
      verified: true,
      title: "Exactly as described",
      body: "Great quality and it arrived earlier than expected. Would order again without hesitation.",
      helpful: 9,
      notHelpful: 1,
    },
    {
      name: "Sofia Reyes",
      date: "May 28, 2026",
      verified: false,
      title: "Good value",
      body: "Does what it says. Packaging could be a little sturdier, but the product itself held up fine.",
      helpful: 4,
      notHelpful: 0,
    },
  ];

  const reviewCardsHtml = SAMPLE_REVIEWS.map(function (review) {
    return (
      '<li class="imagyn-review-card">' +
      '<div class="imagyn-review-card__header">' +
      '<span class="imagyn-review-card__name">' + review.name + "</span>" +
      (review.verified
        ? '<span class="imagyn-pill imagyn-tag imagyn-tag--success">Verified Buyer</span>'
        : "") +
      '<span class="imagyn-review-card__date">' + review.date + "</span>" +
      "</div>" +
      '<span class="imagyn-review-card__stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</span>' +
      '<p class="imagyn-review-card__title">' + review.title + "</p>" +
      '<p class="imagyn-review-card__body">' + review.body + "</p>" +
      '<div class="imagyn-review-card__footer">' +
      '<div class="imagyn-review-card__helpful">' +
      '<span class="imagyn-review-card__helpful-label">Was this helpful?</span>' +
      '<button type="button" class="imagyn-review-card__helpful-btn imagyn-review-card__helpful-btn--active">' +
      THUMBS_UP + "<span>" + review.helpful + "</span></button>" +
      '<button type="button" class="imagyn-review-card__helpful-btn">' +
      THUMBS_DOWN + "<span>" + review.notHelpful + "</span></button>" +
      "</div>" +
      "</div>" +
      "</li>"
    );
  }).join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/appearance-preview/imagyn-tokens.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-utilities.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-typography.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-badge.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-summary.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-review-card.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-button.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-tag.css">
<style>
  body { margin: 0; padding: 24px; background: #fff; }
  .imagyn-preview-stack { display: flex; flex-direction: column; gap: 24px; max-width: 460px; }
  .imagyn-reviews--layout-list .imagyn-reviews__list { display: block; }
  .imagyn-reviews__list { margin: 0; padding: 0; }
  .imagyn-reviews__list li { list-style: none; }
  .imagyn-preview-label { font-family: Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(0,0,0,0.4); margin: 0 0 8px; }
</style>
</head>
<body>
  <div class="imagyn-preview-stack">
    <div>
      <p class="imagyn-preview-label">Near the product title</p>
      <span class="imagyn-card-badge">
        <span class="imagyn-card-badge__stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
        <span class="imagyn-card-badge__count">(128)</span>
      </span>
    </div>

    <div>
      <p class="imagyn-preview-label">Ratings &amp; Reviews section</p>
      <div class="imagyn-summary">
        <div class="imagyn-summary__quickbar">
          <span class="imagyn-summary__quickbar-stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
          <span class="imagyn-summary__quickbar-rating">4.9</span>
          <span class="imagyn-summary__quickbar-count">(128 reviews)</span>
          <span class="imagyn-summary__quickbar-divider"></span>
          <button type="button" class="imagyn-summary__quickbar-write">Write a review</button>
        </div>
      </div>
    </div>

    <button type="button" class="imagyn-btn imagyn-btn--primary">Leave a review</button>

    <ul class="imagyn-reviews__list imagyn-reviews--layout-list">
      ${reviewCardsHtml}
    </ul>
  </div>

  <script src="/appearance-preview/imagyn-appearance.js"></script>
  <script>
    window.addEventListener("message", function (event) {
      if (!event.data || event.data.source !== "imagyn-appearance-draft") return;
      if (window.ImagynAppearance) {
        window.ImagynAppearance.apply(event.data.tokens);
      }
    });
  </script>
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
};
