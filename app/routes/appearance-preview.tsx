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

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/appearance-preview/imagyn-tokens.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-typography.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-badge.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-summary.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-review-card.css">
<link rel="stylesheet" href="/appearance-preview/imagyn-component-button.css">
<style>
  body { margin: 0; padding: 24px; background: #fff; }
  .imagyn-preview-stack { display: flex; flex-direction: column; gap: 24px; max-width: 420px; }
  .imagyn-reviews--layout-list .imagyn-reviews__list { display: block; }
</style>
</head>
<body>
  <div class="imagyn-preview-stack">
    <span class="imagyn-card-badge">
      <span class="imagyn-card-badge__stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
      <span class="imagyn-card-badge__count">(128)</span>
    </span>

    <button type="button" class="imagyn-btn imagyn-btn--primary">Write a review</button>

    <ul class="imagyn-reviews__list imagyn-reviews--layout-list" style="list-style:none;margin:0;padding:0;">
      <li class="imagyn-review-card">
        <div class="imagyn-review-card__header">
          <span class="imagyn-review-card__name">Ava Patel</span>
          <span class="imagyn-review-card__date">Jun 12, 2026</span>
        </div>
        <span class="imagyn-review-card__stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
        <p class="imagyn-review-card__title">Elegant and surprisingly fast</p>
        <p class="imagyn-review-card__body">Setup took minutes and the storefront presentation feels much more premium than our previous reviews app.</p>
      </li>
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
