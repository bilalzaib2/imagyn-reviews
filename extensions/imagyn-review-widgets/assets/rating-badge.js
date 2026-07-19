(function () {
  // Independent of reviews-widget.js by design (the Reviews widget block is not modified
  // by this block). Same App Proxy path and public endpoint are reused, not duplicated —
  // this only reads the `summary` portion of the existing GET /apps/reviews response.
  var PROXY_PATH = "/apps/reviews";

  function renderStars(rating) {
    var full = Math.round(rating);
    var stars = "";
    for (var i = 0; i < 5; i++) {
      stars += i < full ? "★" : "☆";
    }
    return stars;
  }

  function scrollToReviews() {
    var target = document.querySelector("[data-imagyn-reviews]");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function render(root, summary, emptyState) {
    var totalReviews = (summary && summary.totalReviews) || 0;
    var averageRating = (summary && summary.averageRating) || 0;

    if (totalReviews === 0) {
      if (emptyState === "show_text") {
        root.removeAttribute("hidden");
        root.innerHTML = '<span class="imagyn-rating-badge__empty">No reviews yet</span>';
        root.disabled = true;
      } else {
        root.setAttribute("hidden", "");
      }
      return;
    }

    root.removeAttribute("hidden");
    root.innerHTML =
      '<span class="imagyn-rating-badge__stars" aria-hidden="true">' + renderStars(averageRating) + "</span>" +
      '<span class="imagyn-rating-badge__average">' + averageRating.toFixed(1) + "</span>" +
      '<span class="imagyn-rating-badge__count">(' +
      totalReviews +
      (totalReviews === 1 ? " review" : " reviews") +
      ")</span>";

    if (document.querySelector("[data-imagyn-reviews]")) {
      root.disabled = false;
      root.addEventListener("click", scrollToReviews);
    } else {
      root.disabled = true;
    }
  }

  function init(scope) {
    (scope || document).querySelectorAll("[data-imagyn-rating-badge]:not([data-imagyn-badge-initialized])").forEach(function (root) {
      root.setAttribute("data-imagyn-badge-initialized", "true");

      var productId = root.getAttribute("data-product-id");
      var emptyState = root.getAttribute("data-empty-state");
      var starColor = root.getAttribute("data-star-color");
      var textColor = root.getAttribute("data-text-color");

      if (starColor) root.style.setProperty("--imagyn-badge-star-color", starColor);
      if (textColor) root.style.setProperty("--imagyn-badge-text-color", textColor);

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
          if (!data || !data.ok) {
            throw new Error((data && data.error) || "Unable to load rating");
          }
          render(root, data.summary, emptyState);
        })
        .catch(function () {
          root.setAttribute("hidden", "");
        });
    });
  }

  init();

  // Same Theme Editor compatibility mechanism as the Reviews widget block, kept in this
  // separate file so the two blocks stay fully independent.
  document.addEventListener("shopify:section:load", function (event) {
    init(event.target);
  });
})();
