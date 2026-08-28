(function () {
  // Same App Proxy path convention as every other widget script — Shopify's proxy layer
  // appends `shop` (plus the signature it verifies) to every proxied request automatically.
  // See app/routes/api.reviews.medals.tsx and shopify.app.toml's [app_proxy] config
  // (prefix "apps", subpath "reviews" -> this resolves to /apps/reviews/medals).
  var PROXY_PATH = "/apps/reviews/medals";

  var uidCounter = 0;

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

  // Mirrors Medallion.tsx's FINISH_BY_TIER exactly — four brushed-metal finishes, one per
  // tier, strictly monochrome (no hue, matching Imagyn's brand restraint). `base` is a
  // deliberate contrast tone against this finish's own face gradient, not a same-as-metal
  // fill — a first pass tried that and the glyph nearly vanished at small sizes (and on
  // large filled shapes like the trust shield, at any size). Dark glyph on light finishes,
  // light glyph on dark finishes; still strictly grayscale. Keep both in sync if this ever
  // changes.
  var FINISH_STOPS = {
    pewter: { faceLight: "#d6d7da", faceDark: "#a7a8ad", rimLight: "#c7c8cc", rimDark: "#87888d", engrave: "rgba(13,14,15,0.22)", base: "#4c4d52" },
    silver: { faceLight: "#f1f2f4", faceDark: "#c1c2c6", rimLight: "#e2e3e6", rimDark: "#9a9ca0", engrave: "rgba(13,14,15,0.18)", base: "#3a3b3f" },
    graphite: { faceLight: "#6f7075", faceDark: "#3d3e42", rimLight: "#5b5c60", rimDark: "#28292c", engrave: "rgba(255,255,255,0.14)", base: "#dcdde0" },
    // Bottoms out at #0d0e0f, the exact near-black used by the brand mark itself
    // (public/assets/imagyn-app-logo.svg) — see Medallion.tsx's own comment on this.
    onyx: { faceLight: "#35363a", faceDark: "#0d0e0f", rimLight: "#232427", rimDark: "#000000", engrave: "rgba(255,255,255,0.16)", base: "#e9eaec" },
  };
  var FINISH_BY_TIER = ["pewter", "silver", "graphite", "onyx"];

  function finishForTier(tier) {
    var index = Math.min(Math.max(Math.round(tier) || 1, 1), FINISH_BY_TIER.length) - 1;
    return FINISH_BY_TIER[index];
  }

  // Renders one realistic medallion as an inline SVG string. Same technique as
  // Medallion.tsx: a radial-gradient face + linear-gradient rim for the beveled-disc
  // illusion, an engraved groove near the rim, and a three-layer emboss (dark multiply
  // copy + light screen copy + true-position base) for the category glyph — flat shapes
  // only, no filters, so this stays crisp and cheap at any size, including the small
  // scale this renders at inside a showcase grid.
  function renderMedallion(category, tier, size) {
    var uid = "ims-" + uidCounter++;
    var finish = FINISH_STOPS[finishForTier(tier)];
    var faceId = uid + "-face";
    var rimId = uid + "-rim";
    var glyph = GLYPH_BY_CATEGORY[category];

    // isolation:isolate is required here — without it, when several medallions render
    // together in the showcase grid, one instance's multiply/screen emboss blend bleeds
    // into neighboring medallions instead of staying scoped to its own face (confirmed via
    // the admin gallery preview, which hits the same bug with the same fix in
    // Medallion.tsx's CSS — see that file's comment for the full explanation).
    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true" class="imagyn-medals-showcase__medallion" style="isolation:isolate">';
    svg += "<defs>";
    svg += '<radialGradient id="' + faceId + '" cx="36%" cy="28%" r="80%">';
    svg += '<stop offset="0%" stop-color="' + finish.faceLight + '"></stop>';
    svg += '<stop offset="100%" stop-color="' + finish.faceDark + '"></stop>';
    svg += "</radialGradient>";
    svg += '<linearGradient id="' + rimId + '" x1="15%" y1="5%" x2="90%" y2="100%">';
    svg += '<stop offset="0%" stop-color="' + finish.rimLight + '"></stop>';
    svg += '<stop offset="100%" stop-color="' + finish.rimDark + '"></stop>';
    svg += "</linearGradient>";
    svg += "</defs>";
    svg += '<circle cx="12" cy="12" r="10.5" stroke="url(#' + rimId + ')" stroke-width="1.4" fill="none"></circle>';
    svg += '<circle cx="12" cy="12" r="9" fill="url(#' + faceId + ')"></circle>';
    svg += '<circle cx="12" cy="12" r="7.4" stroke="' + finish.engrave + '" stroke-width="0.6" fill="none"></circle>';

    var shadowStyle = 'fill="#000000" opacity="0.4" style="mix-blend-mode:multiply"';
    var highlightStyle = 'fill="#ffffff" opacity="0.32" style="mix-blend-mode:screen"';

    if (category === "ranking") {
      svg += '<circle cx="12.35" cy="12.45" r="5.5" fill="none" stroke="#000000" stroke-width="1.25" opacity="0.4" style="mix-blend-mode:multiply"></circle>';
      svg += '<circle cx="11.75" cy="11.7" r="5.5" fill="none" stroke="#ffffff" stroke-width="1.25" opacity="0.32" style="mix-blend-mode:screen"></circle>';
      svg += '<circle cx="12" cy="12" r="5.5" fill="none" stroke="' + finish.base + '" stroke-width="1.25"></circle>';
      svg += '<circle cx="12.35" cy="12.45" r="2" ' + shadowStyle + "></circle>";
      svg += '<circle cx="11.75" cy="11.7" r="2" ' + highlightStyle + "></circle>";
      svg += '<circle cx="12" cy="12" r="2" fill="' + finish.base + '"></circle>';
    } else if (glyph) {
      svg += '<path d="' + glyph + '" transform="translate(0.35 0.45)" ' + shadowStyle + "></path>";
      svg += '<path d="' + glyph + '" transform="translate(-0.25 -0.3)" ' + highlightStyle + "></path>";
      svg += '<path d="' + glyph + '" fill="' + finish.base + '"></path>';
    }

    svg += "</svg>";
    return svg;
  }

  function formatEarnedDate(value) {
    try {
      return new Intl.DateTimeFormat(document.documentElement.lang || "en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
    } catch (error) {
      return "";
    }
  }

  function renderMedalCard(medal) {
    var html = '<li class="imagyn-medals-showcase__item">';
    html += renderMedallion(medal.category, medal.tier, 72);
    html += '<div class="imagyn-medals-showcase__body">';
    html += '<p class="imagyn-medals-showcase__name">' + escapeHtml(medal.name) + "</p>";
    html += '<p class="imagyn-medals-showcase__description">' + escapeHtml(medal.description) + "</p>";
    var earnedLabel = formatEarnedDate(medal.earnedAt);
    if (earnedLabel) {
      html += '<p class="imagyn-medals-showcase__meta">Earned ' + escapeHtml(earnedLabel) + "</p>";
    }
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
