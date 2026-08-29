(function () {
  // Same App Proxy convention as every other widget script — Shopify's proxy layer appends
  // `shop` (plus the signature it verifies) to every proxied request automatically. See
  // app/routes/api.reviews.store.tsx and shopify.app.toml's [app_proxy] config (prefix
  // "apps", subpath "reviews" -> this resolves to /apps/reviews/store).
  var PROXY_PATH = "/apps/reviews/store";

  var renderStars = window.ImagynShared.renderStars;
  var escapeHtml = window.ImagynShared.escapeHtml;

  // Mirrors medals-showcase.js's own glyph set exactly (and Medallion.tsx's
  // GLYPH_BY_CATEGORY) — the same original Imagyn glyph paths, not a separate icon set.
  var GLYPH_BY_CATEGORY = {
    verified: "M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z",
    milestone: "M4 17h16l-5-9-3.5 6-2-3z",
    trust: "M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6z",
    trending: "M4 16l6-6 4 4 6-7",
  };
  var FINISH_STOPS = {
    pewter: { ring: "#a7a8ad", fill: "color-mix(in srgb, #a7a8ad 14%, #ffffff)", base: "#4c4d52" },
    silver: { ring: "#9a9ca0", fill: "color-mix(in srgb, #9a9ca0 10%, #ffffff)", base: "#3a3b3f" },
    graphite: { ring: "#3d3e42", fill: "#3d3e42", base: "#dcdde0" },
    onyx: { ring: "#0d0e0f", fill: "#0d0e0f", base: "#e9eaec" },
  };
  var FINISH_BY_TIER = ["pewter", "silver", "graphite", "onyx"];

  function finishForTier(tier) {
    var index = Math.min(Math.max(Math.round(tier) || 1, 1), FINISH_BY_TIER.length) - 1;
    return FINISH_BY_TIER[index];
  }

  // Same flat-badge technique as medals-showcase.js's renderMedallion — kept as its own small
  // copy (not a cross-script import) matching this extension's existing convention of each
  // widget script being self-contained. Keep both in sync if the medal artwork ever changes.
  function renderMedallion(category, tier) {
    var finish = FINISH_STOPS[finishForTier(tier)];
    var glyph = GLYPH_BY_CATEGORY[category];

    var svg = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true" class="imagyn-medals-showcase__medallion">';
    svg += '<circle cx="12" cy="12" r="10.5" stroke="' + finish.ring + '" stroke-width="1.5" fill="none"></circle>';
    svg += '<circle cx="12" cy="12" r="9" fill="' + finish.fill + '"></circle>';

    if (category === "ranking") {
      svg += '<circle cx="12" cy="12" r="5.5" fill="none" stroke="' + finish.base + '" stroke-width="1.25"></circle>';
      svg += '<circle cx="12" cy="12" r="2" fill="' + finish.base + '"></circle>';
    } else if (glyph) {
      svg += '<path d="' + glyph + '" fill="' + finish.base + '"></path>';
    }

    svg += '<g opacity="0.55" fill="' + finish.base + '">';
    svg += '<circle cx="9.4" cy="19.1" r="0.55"></circle>';
    svg += '<circle cx="12" cy="19.6" r="0.7"></circle>';
    svg += '<circle cx="14.6" cy="19.1" r="0.55"></circle>';
    svg += "</g>";

    svg += "</svg>";
    return svg;
  }

  function renderMedals(medals) {
    if (!medals || medals.length === 0) {
      return "";
    }

    var html = '<ul class="imagyn-medals-showcase__list imagyn-store-reviews__medals-list">';
    for (var i = 0; i < medals.length; i++) {
      var medal = medals[i];
      html +=
        '<li class="imagyn-medals-showcase__item">' +
        renderMedallion(medal.category, medal.tier) +
        '<div class="imagyn-medals-showcase__body">' +
        '<p class="imagyn-medals-showcase__name">' + escapeHtml(medal.name) + "</p>" +
        '<p class="imagyn-medals-showcase__description">' + escapeHtml(medal.description) + "</p>" +
        "</div></li>";
    }
    html += "</ul>";
    return html;
  }

  function renderEmptyState() {
    return (
      '<p class="imagyn-store-reviews__empty">No store reviews yet — reviews you approve on any product count toward your store rating.</p>'
    );
  }

  function render(container, data) {
    var summary = data.summary || { averageRating: 0, totalReviews: 0, ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    var totalReviews = summary.totalReviews || 0;
    var heading = container.getAttribute("data-heading") || "";

    var html = "";
    if (heading) {
      html += '<p class="imagyn-store-reviews__heading">' + escapeHtml(heading) + "</p>";
    }

    html += '<div class="imagyn-summary imagyn-store-reviews__summary">';
    html += '<div class="imagyn-summary__hero">';

    if (totalReviews === 0) {
      html += renderEmptyState();
    } else {
      html += '<div class="imagyn-summary__headline">';
      html += '<span class="imagyn-summary__rating">' + summary.averageRating.toFixed(1) + "</span>";
      html += '<span class="imagyn-summary__quickbar-stars" aria-hidden="true">' + renderStars(summary.averageRating) + "</span>";
      html += "</div>";
      html +=
        '<span class="imagyn-summary__count">Based on ' + totalReviews + (totalReviews === 1 ? " store review" : " store reviews") + "</span>";
      html += window.ImagynShared.renderHistogram(summary.ratingCounts);
    }

    html += "</div>";
    html += "</div>";

    var medalsHtml = renderMedals(data.medals);
    if (medalsHtml) {
      html += '<div class="imagyn-medals-showcase imagyn-store-reviews__medals">';
      html += '<p class="imagyn-ratings-section__label">Achievements</p>';
      html += medalsHtml;
      html += "</div>";
    }

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
        // Fails quietly, same reasoning as review-carousel.js/medals-showcase.js's own
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
