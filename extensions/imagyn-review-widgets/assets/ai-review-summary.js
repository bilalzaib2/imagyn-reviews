(function () {
  // Independent of reviews-widget.js by design (same convention as rating-badge.js) — a
  // merchant can place this block anywhere on the product page (e.g. right under the Buy
  // Box) without needing the full Reviews widget on the same page. Reuses the same App
  // Proxy endpoint and reads only the `aiSummary`/`appearance` portions of its response —
  // no separate backend route, no separate generation trigger. Pure cache read on the
  // server side (getAiSummary), so this can never add generation latency to a storefront
  // page view; it renders nothing at all until a merchant has generated a summary once.
  var PROXY_PATH = "/apps/reviews";

  var escapeHtml = window.ImagynShared.escapeHtml;

  // Identical markup/classes to reviews-widget.js's own renderAiSummary — same visual
  // component, just mountable on its own. Kept as a literal copy (not an extracted shared
  // helper) for the same reason rating-badge.js's renderStars call is the only shared bit
  // between these blocks: the two call sites' surrounding DOM/lifecycle are different
  // enough that a shared render helper would need its own indirection layer for no real
  // gain — see STOREFRONT_DESIGN_SYSTEM.md's per-block independence convention.
  function renderAiSummary(aiSummary) {
    var html = '<div class="imagyn-ai-summary">';
    html += '<p class="imagyn-ratings-section__label imagyn-ai-summary__heading">AI Review Summary</p>';
    html += '<p class="imagyn-ai-summary__text">' + escapeHtml(aiSummary.summary) + "</p>";
    if (aiSummary.recommendation) {
      html +=
        '<p class="imagyn-ai-summary__recommendation"><strong>Recommended for:</strong> ' +
        escapeHtml(aiSummary.recommendation) +
        "</p>";
    }
    html += "</div>";
    return html;
  }

  function init(scope) {
    (scope || document).querySelectorAll("[data-imagyn-ai-summary-block]:not([data-imagyn-ai-summary-initialized])").forEach(function (root) {
      root.setAttribute("data-imagyn-ai-summary-initialized", "true");

      var productId = root.getAttribute("data-product-id");
      if (!productId) {
        root.setAttribute("hidden", "");
        return;
      }

      var endpoint = PROXY_PATH + "?productId=" + encodeURIComponent(productId);

      fetch(endpoint, { headers: { Accept: "application/json" } })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Request failed");
          }
          return response.json();
        })
        .then(function (data) {
          if (!data || !data.ok || !data.aiSummary || !data.aiSummary.summary) {
            root.setAttribute("hidden", "");
            return;
          }

          if (window.ImagynAppearance) {
            window.ImagynAppearance.apply(data.appearance);
          }

          root.innerHTML = renderAiSummary(data.aiSummary);
          root.removeAttribute("hidden");
        })
        .catch(function () {
          root.setAttribute("hidden", "");
        });
    });
  }

  init();

  // Same Theme Editor compatibility mechanism as the other standalone blocks.
  document.addEventListener("shopify:section:load", function (event) {
    init(event.target);
  });
})();
