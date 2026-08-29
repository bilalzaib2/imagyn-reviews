(function () {
  // Same App Proxy path convention as every other widget script — Shopify's proxy layer
  // appends `shop` (plus the signature it verifies) to every proxied request automatically.
  // See app/routes/api.reviews.medals.tsx and shopify.app.toml's [app_proxy] config
  // (prefix "apps", subpath "reviews" -> this resolves to /apps/reviews/medals).
  var PROXY_PATH = "/apps/reviews/medals";

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value === null || value === undefined ? "" : String(value);
    return div.innerHTML;
  }

  // Mirrors app/components/medals/Medallion.tsx's GLYPH_BY_CATEGORY exactly — the same
  // original Imagyn glyph paths, not a separate icon set. Keep both in sync.
  var GLYPH_BY_CATEGORY = {
    verified: "M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z",
    milestone: "M4 17h16l-5-9-3.5 6-2-3z",
    trust: "M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6z",
    trending: "M4 16l6-6 4 4 6-7",
  };

  // Mirrors Medallion.tsx's FINISH_BY_TIER exactly — four flat tones, one per tier, strictly
  // monochrome (no hue, matching Imagyn's brand restraint). `base` is a deliberate contrast
  // tone against this tier's own fill, not a same-as-fill glyph — dark glyph on light tiers,
  // light glyph on dark tiers. Keep both in sync if this ever changes.
  var FINISH_STOPS = {
    pewter: { ring: "#a7a8ad", fill: "color-mix(in srgb, #a7a8ad 14%, #ffffff)", base: "#4c4d52" },
    silver: { ring: "#9a9ca0", fill: "color-mix(in srgb, #9a9ca0 10%, #ffffff)", base: "#3a3b3f" },
    graphite: { ring: "#3d3e42", fill: "#3d3e42", base: "#dcdde0" },
    // Bottoms out at #0d0e0f, the exact near-black used by the brand mark itself
    // (public/assets/imagyn-app-logo.svg) — see Medallion.tsx's own comment on this.
    onyx: { ring: "#0d0e0f", fill: "#0d0e0f", base: "#e9eaec" },
  };
  var FINISH_BY_TIER = ["pewter", "silver", "graphite", "onyx"];

  function finishForTier(tier) {
    var index = Math.min(Math.max(Math.round(tier) || 1, 1), FINISH_BY_TIER.length) - 1;
    return FINISH_BY_TIER[index];
  }

  // Renders one medallion as an inline SVG string. Same technique as Medallion.tsx: a flat
  // ring + flat fill + flat glyph, deliberately restrained (no gradient, no bevel, no emboss,
  // no drop shadow) — a small, calm badge, not a rendered 3D object.
  function renderMedallion(category, tier, size) {
    var finish = FINISH_STOPS[finishForTier(tier)];
    var glyph = GLYPH_BY_CATEGORY[category];

    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true" class="imagyn-medals-showcase__medallion">';
    svg += '<circle cx="12" cy="12" r="10.5" stroke="' + finish.ring + '" stroke-width="1.5" fill="none"></circle>';
    svg += '<circle cx="12" cy="12" r="9" fill="' + finish.fill + '"></circle>';

    if (category === "ranking") {
      svg += '<circle cx="12" cy="12" r="5.5" fill="none" stroke="' + finish.base + '" stroke-width="1.25"></circle>';
      svg += '<circle cx="12" cy="12" r="2" fill="' + finish.base + '"></circle>';
    } else if (glyph) {
      svg += '<path d="' + glyph + '" fill="' + finish.base + '"></path>';
    }

    // A tiny, subtle Imagyn signature — three small dots echoing the brand emblem's own
    // dot-grid motif, tucked at the bottom of the ring. See Medallion.tsx's own comment.
    svg += '<g opacity="0.55" fill="' + finish.base + '">';
    svg += '<circle cx="9.4" cy="19.1" r="0.55"></circle>';
    svg += '<circle cx="12" cy="19.6" r="0.7"></circle>';
    svg += '<circle cx="14.6" cy="19.1" r="0.55"></circle>';
    svg += "</g>";

    svg += "</svg>";
    return svg;
  }

  // Compact card: a small flat badge (44px, down from the previous 72px brushed-metal
  // treatment) with tight name/description text beneath — sized so several sit comfortably
  // in one horizontal row, per the Medals Showcase redesign (see imagyn-medals-showcase__item
  // in imagyn-component-medals-showcase.css). Earned-date meta was dropped for compactness —
  // it's the least essential fact here, and the flat design otherwise reads as a quiet row of
  // achievements, not a set of data cards.
  function renderMedalCard(medal) {
    var html = '<li class="imagyn-medals-showcase__item">';
    html += renderMedallion(medal.category, medal.tier, 44);
    html += '<div class="imagyn-medals-showcase__body">';
    html += '<p class="imagyn-medals-showcase__name">' + escapeHtml(medal.name) + "</p>";
    html += '<p class="imagyn-medals-showcase__description">' + escapeHtml(medal.description) + "</p>";
    html += "</div></li>";
    return html;
  }

  function initShowcase(container) {
    var heading = container.getAttribute("data-heading") || "";

    fetch(PROXY_PATH, { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Request failed");
        }
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          throw new Error((data && data.error) || "Unable to load medals");
        }

        if (window.ImagynAppearance) {
          window.ImagynAppearance.apply(data.appearance, container);
        }

        var medals = data.medals || [];

        // Empty state: hide the whole block rather than showing a locked/placeholder
        // state — matches Review Carousel's own "no data to render" convention exactly
        // (see review-carousel.js). A merchant with no medals yet simply doesn't see an
        // empty showcase on their homepage.
        if (medals.length === 0) {
          container.innerHTML = "";
          return;
        }

        var html = "";
        if (heading) {
          html += '<p class="imagyn-medals-showcase__heading">' + escapeHtml(heading) + "</p>";
        }
        html += '<ul class="imagyn-medals-showcase__list">' + medals.map(renderMedalCard).join("") + "</ul>";
        container.innerHTML = html;
      })
      .catch(function () {
        // Fails quietly, same reasoning as review-carousel.js's own catch — a broken/
        // unavailable showcase disappears rather than showing an error block on a
        // homepage where a shopper has no recovery action available anyway.
        container.innerHTML = "";
      });
  }

  function init() {
    var containers = document.querySelectorAll("[data-imagyn-medals-showcase]");
    for (var i = 0; i < containers.length; i++) {
      initShowcase(containers[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
