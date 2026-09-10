(function () {
  // Standalone Theme App Block — the ONE persisted, store-wide Store AI Summary
  // (aiSummary.server.ts's regenerateStoreAiSummary/getStoreAiSummary), placeable on any
  // page without the full Store Reviews widget or Public Review Site present. Has no
  // admin-side on/off flag of its own: a merchant adding or removing this block in the
  // Theme Editor IS its on/off control, matching every other standalone block in this
  // extension (see api.reviews.store-ai-summary.tsx). Never accepts or requires a
  // productId — this is genuinely store-level, not "whichever product was summarized
  // last."
  var PROXY_PATH = "/apps/reviews/store-ai-summary";

  var escapeHtml = window.ImagynShared.escapeHtml;

  function renderLoading() {
    return '<p class="imagyn-ai-summary__status">Loading store review summary…</p>';
  }

  function renderError() {
    return '<p class="imagyn-ai-summary__status">Store review summary is unavailable right now.</p>';
  }

  // Same markup/classes as ai-review-summary.js's renderAiSummary (product-level) — one
  // shared visual component, a different, store-scoped data source.
  function renderAiSummary(aiSummary) {
    var html = '<div class="imagyn-ai-summary">';
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

  function init(scope) {
    (scope || document)
      .querySelectorAll("[data-imagyn-store-ai-summary]:not([data-imagyn-store-ai-summary-initialized])")
      .forEach(function (root) {
        root.setAttribute("data-imagyn-store-ai-summary-initialized", "true");
        root.removeAttribute("hidden");
        root.innerHTML = renderLoading();

        fetch(PROXY_PATH, { headers: { Accept: "application/json" } })
          .then(function (response) {
            if (!response.ok) {
              throw new Error("Request failed");
            }
            return response.json();
          })
          .then(function (data) {
            if (!data || !data.ok) {
              throw new Error((data && data.error) || "Unable to load store AI summary");
            }

            if (window.ImagynAppearance) {
              window.ImagynAppearance.apply(data.appearance);
            }

            if (!data.storeAiSummary || !data.storeAiSummary.summary) {
              root.setAttribute("hidden", "");
              root.innerHTML = "";
              return;
            }

            root.innerHTML = renderAiSummary(data.storeAiSummary);
          })
          .catch(function () {
            root.innerHTML = renderError();
          });
      });
  }

  init();

  // Same Theme Editor compatibility mechanism as the other standalone blocks.
  document.addEventListener("shopify:section:load", function (event) {
    init(event.target);
  });
})();
