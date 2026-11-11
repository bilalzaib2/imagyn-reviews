(function () {
  // Same App Proxy convention as every other widget script — Shopify's proxy layer appends
  // `shop` (plus the signature it verifies) to every proxied request automatically. See
  // app/routes/api.reviews.store.tsx and shopify.app.toml's [app_proxy] config (prefix
  // "apps", subpath "reviews" -> this resolves to /apps/reviews/store).
  var PROXY_PATH = "/apps/reviews/store";

  var renderStars = window.ImagynShared.renderStars;
  var escapeHtml = window.ImagynShared.escapeHtml;

  // Imagyn's own small brand mark (public/assets/imagyn-emblem.svg, inlined) — same icon
  // review-carousel.js uses for its "Verified" badge. currentColor (not the source file's
  // hardcoded #070808) so it follows this text's own muted color instead of painting a
  // fixed dark circle regardless of theme.
  var IMAGYN_ICON =
    '<svg class="imagyn-store-reviews__verified-icon" viewBox="0 0 54.86 54.58" aria-hidden="true" focusable="false">' +
    '<circle cx="27.46" cy="7.01" r="7.01" fill="currentColor"/>' +
    '<circle cx="27.4" cy="47.57" r="7.01" fill="currentColor"/>' +
    '<circle cx="47.85" cy="7.01" r="4.67" fill="currentColor"/>' +
    '<circle cx="47.85" cy="47.57" r="4.67" fill="currentColor"/>' +
    '<circle cx="47.85" cy="27.32" r="7.01" fill="currentColor"/>' +
    '<circle cx="7.01" cy="7.01" r="4.67" fill="currentColor"/>' +
    '<circle cx="7.01" cy="47.57" r="4.67" fill="currentColor"/>' +
    '<circle cx="7.01" cy="27.26" r="7.01" fill="currentColor"/>' +
    "</svg>";

  // Same markup/classes as reviews-widget.js's own renderAiSummary (product-level) — one
  // shared visual component, two independent data sources. data.storeAiSummary is the real,
  // persisted Store AI Summary (see api.reviews.store.tsx) — never a per-product fallback,
  // and never present at all unless the merchant has turned this surface on AND a summary has
  // actually been generated, so this function only ever needs to check "is it here."
  function renderAiSummary(aiSummary) {
    if (!aiSummary || !aiSummary.summary) {
      return "";
    }

    var html = '<div class="imagyn-ai-summary imagyn-store-reviews__ai-summary">';
    html += '<p class="imagyn-ratings-section__label imagyn-ai-summary__heading">AI Review Summary</p>';
    html += '<p class="imagyn-ai-summary__text">' + escapeHtml(aiSummary.summary) + "</p>";
    html +=
      '<p class="imagyn-ai-summary__recommendation">Based on ' +
      aiSummary.reviewCountUsed +
      (aiSummary.reviewCountUsed === 1 ? " approved review" : " approved reviews") +
      "</p>";
    html += "</div>";
    return html;
  }

  function renderEmptyState() {
    return (
      '<p class="imagyn-store-reviews__empty">No store reviews yet — reviews you approve on any product count toward your store rating.</p>'
    );
  }

  // "true"/"false" arrive as literal strings from Liquid's {{ block.settings.x }} — a real
  // boolean setting always renders one of those two words, never blank, so an explicit
  // string check (not truthy-string-coercion, which would treat "false" as truthy) is the
  // correct read here.
  function isOn(value) {
    return value !== "false";
  }

  // 2026-09-09 layout redesign: replaces the old single centered, narrow (22rem-capped)
  // column with a wide three-part horizontal grid — rating, distribution, CTA — matching a
  // mature review platform's store-review summary (studied for product-experience/hierarchy
  // only; no assets, copy, or code from any reference site). Falls back to a single stacked
  // column below the tablet breakpoint via CSS grid, not a second JS render path.
  //
  // `visibility` (show_rating/show_distribution/show_cta) lets a merchant turn off any one
  // part via the block's own theme editor settings — e.g. a store with only a handful of
  // reviews might hide the distribution and keep just the headline number, or a store with
  // no honest place to send a shopper yet might turn the CTA off entirely rather than have
  // this file guess at intent.
  function renderSummaryGrid(summary, ctaLabel, ctaUrl, visibility) {
    var totalReviews = summary.totalReviews || 0;

    if (totalReviews === 0) {
      return '<div class="imagyn-store-reviews__grid imagyn-store-reviews__grid--empty">' + renderEmptyState() + "</div>";
    }

    var html = '<div class="imagyn-store-reviews__grid">';

    if (visibility.rating) {
      html += '<div class="imagyn-store-reviews__rating">';
      html += '<span class="imagyn-store-reviews__rating-number">' + summary.averageRating.toFixed(1) + "</span>";
      html += '<span class="imagyn-store-reviews__rating-stars" aria-hidden="true">' + renderStars(summary.averageRating) + "</span>";
      html +=
        '<span class="imagyn-store-reviews__rating-count">Based on ' + totalReviews +
        (totalReviews === 1 ? " store review" : " store reviews") + IMAGYN_ICON + "</span>";
      html += "</div>";
    }

    if (visibility.distribution) {
      html += '<div class="imagyn-store-reviews__distribution">';
      html += window.ImagynShared.renderHistogram(summary.ratingCounts, { starLabels: true });
      html += "</div>";
    }

    if (visibility.cta && ctaUrl) {
      html += '<div class="imagyn-store-reviews__cta">';
      html += '<a class="imagyn-store-reviews__write" href="' + escapeHtml(ctaUrl) + '">' + escapeHtml(ctaLabel || "Write a Review") + "</a>";
      html += "</div>";
    }

    html += "</div>";
    return html;
  }

  function render(container, data) {
    var summary = data.summary || { averageRating: 0, totalReviews: 0, ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    var heading = container.getAttribute("data-heading") || "";
    var ctaLabel = container.getAttribute("data-cta-label") || "";
    var ctaUrl = container.getAttribute("data-cta-url") || "";
    var maxWidth = container.getAttribute("data-max-width");
    var size = container.getAttribute("data-size") || "standard";
    var visibility = {
      rating: isOn(container.getAttribute("data-show-rating")),
      distribution: isOn(container.getAttribute("data-show-distribution")),
      cta: isOn(container.getAttribute("data-show-cta")),
      aiSummary: isOn(container.getAttribute("data-show-ai-summary")),
    };

    if (maxWidth) {
      container.style.setProperty("--imagyn-store-reviews-max-width", maxWidth + "px");
    }
    container.setAttribute("data-imagyn-size", size);

    var html = "";
    if (heading) {
      html += '<p class="imagyn-store-reviews__heading">' + escapeHtml(heading) + "</p>";
    }

    html += renderSummaryGrid(summary, ctaLabel, ctaUrl, visibility);
    // Two independent gates, same pattern as the Product Reviews widget: the server only
    // includes data.storeAiSummary at all when Store.aiSummaryOnStoreReviewsEnabled is on
    // (see api.reviews.store.tsx), and visibility.aiSummary is this block's own Theme
    // Editor "Show AI Summary" setting for this specific instance.
    html += visibility.aiSummary ? renderAiSummary(data.storeAiSummary) : "";

    container.innerHTML = html;
    window.ImagynShared.animateHistogramFills(container);
  }

  function initWidget(container) {
    fetch(PROXY_PATH, { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Request failed");
        }
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          throw new Error((data && data.error) || "Unable to load store reviews");
        }

        if (window.ImagynAppearance) {
          window.ImagynAppearance.apply(data.appearance, container);
        }

        render(container, data);
      })
      .catch(function () {
        // Fails quietly, same reasoning as review-carousel.js's own
        // catch — a broken/unavailable widget disappears rather than showing an error block
        // on a page where a shopper has no recovery action available anyway.
        container.innerHTML = "";
      });
  }

  function init() {
    var containers = document.querySelectorAll("[data-imagyn-store-reviews]");
    for (var i = 0; i < containers.length; i++) {
      initWidget(containers[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
