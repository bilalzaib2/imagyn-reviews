(function () {
  // Independent of reviews-widget.js by design (the Reviews widget block is not modified
  // by this block). Same App Proxy path and public endpoint are reused, not duplicated —
  // this only reads the `summary`/`widget` portions of the existing GET /apps/reviews
  // response. Cross-block coordination with the write-review form (which lives inside the
  // separate Reviews widget block, positioned lower on the page) happens over two custom
  // events on `document` rather than any direct reference between the two blocks:
  //   - this block dispatches "imagyn:write-review-toggle" when its own trigger is clicked
  //   - reviews-widget.js dispatches "imagyn:write-review-state" ({expanded}) after acting
  //     on that, so this block's button can keep its own aria-expanded in sync.
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

  function hasWriteReviewForm() {
    return !!document.querySelector("[data-imagyn-form]");
  }

  function render(root, summary, widgetSettings, emptyState) {
    var totalReviews = (summary && summary.totalReviews) || 0;
    var averageRating = (summary && summary.averageRating) || 0;

    var showStats = totalReviews > 0;
    var showEmptyText = totalReviews === 0 && emptyState === "show_text";
    // The write-review affordance stays available regardless of review count (matching
    // the widget's own "the Write a Review affordance stays fully present regardless of
    // review count" rule) — it only depends on the merchant's setting and whether a
    // write-review form actually exists on this page.
    var showWrite = hasWriteReviewForm() && (!widgetSettings || widgetSettings.showWriteReviewButton !== false);

    if (!showStats && !showEmptyText && !showWrite) {
      root.setAttribute("hidden", "");
      return;
    }

    root.removeAttribute("hidden");

    var html = "";

    if (showStats) {
      var canScroll = !!document.querySelector("[data-imagyn-reviews]");
      var statsInner =
        '<span class="imagyn-rating-badge__stars" aria-hidden="true">' + renderStars(averageRating) + "</span>" +
        '<span class="imagyn-rating-badge__average">' + averageRating.toFixed(1) + "</span>" +
        '<span class="imagyn-rating-badge__count">(' +
        totalReviews +
        (totalReviews === 1 ? " review" : " reviews") +
        ")</span>";

      html += canScroll
        ? '<button type="button" class="imagyn-rating-badge__link" data-imagyn-badge-scroll>' + statsInner + "</button>"
        : '<span class="imagyn-rating-badge__link">' + statsInner + "</span>";
    } else if (showEmptyText) {
      html += '<span class="imagyn-rating-badge__empty">No reviews yet</span>';
    }

    if (showWrite) {
      if (showStats || showEmptyText) {
        html += '<span class="imagyn-summary__quickbar-divider" aria-hidden="true"></span>';
      }
      html +=
        '<button type="button" class="imagyn-summary__quickbar-write" data-imagyn-badge-write aria-expanded="false">' +
        "Write a review</button>";
    }

    root.innerHTML = html;

    var scrollBtn = root.querySelector("[data-imagyn-badge-scroll]");
    if (scrollBtn) {
      scrollBtn.addEventListener("click", scrollToReviews);
    }

    var writeBtn = root.querySelector("[data-imagyn-badge-write]");
    if (writeBtn) {
      writeBtn.addEventListener("click", function () {
        document.dispatchEvent(new CustomEvent("imagyn:write-review-toggle"));
      });
      document.addEventListener("imagyn:write-review-state", function (event) {
        writeBtn.setAttribute("aria-expanded", event.detail && event.detail.expanded ? "true" : "false");
      });
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
          render(root, data.summary, data.widget, emptyState);
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
