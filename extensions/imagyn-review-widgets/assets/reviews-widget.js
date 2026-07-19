(function () {
  function renderStars(rating) {
    var full = Math.round(rating);
    var stars = "";
    for (var i = 0; i < 5; i++) {
      stars += i < full ? "★" : "☆";
    }
    return stars;
  }

  function formatDate(value) {
    try {
      return new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (error) {
      return "";
    }
  }

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value === null || value === undefined ? "" : String(value);
    return div.innerHTML;
  }

  function render(root, data) {
    var summary = data.summary || { averageRating: 0, totalReviews: 0 };
    var reviews = data.reviews || [];

    var summaryHtml =
      '<div class="imagyn-reviews__summary">' +
      '<span class="imagyn-reviews__stars" aria-hidden="true">' + renderStars(summary.averageRating) + "</span>" +
      '<span class="imagyn-reviews__average">' + summary.averageRating.toFixed(1) + "</span>" +
      '<span class="imagyn-reviews__count">(' +
      summary.totalReviews +
      (summary.totalReviews === 1 ? " review" : " reviews") +
      ")</span>" +
      "</div>";

    var listHtml;
    if (reviews.length === 0) {
      listHtml = '<p class="imagyn-reviews__empty">No reviews yet.</p>';
    } else {
      listHtml =
        '<ul class="imagyn-reviews__list">' +
        reviews
          .map(function (review) {
            return (
              '<li class="imagyn-reviews__item">' +
              '<div class="imagyn-reviews__item-header">' +
              '<span class="imagyn-reviews__item-stars" aria-hidden="true">' + renderStars(review.rating) + "</span>" +
              (review.title
                ? '<strong class="imagyn-reviews__item-title">' + escapeHtml(review.title) + "</strong>"
                : "") +
              "</div>" +
              '<p class="imagyn-reviews__item-content">' + escapeHtml(review.content) + "</p>" +
              '<p class="imagyn-reviews__item-meta">' +
              escapeHtml(review.reviewerName) +
              " &middot; " +
              formatDate(review.createdAt) +
              "</p>" +
              "</li>"
            );
          })
          .join("") +
        "</ul>";
    }

    root.innerHTML = summaryHtml + listHtml;
  }

  document.querySelectorAll("[data-imagyn-reviews]").forEach(function (root) {
    var appUrl = root.getAttribute("data-app-url");
    var shop = root.getAttribute("data-shop");
    var productId = root.getAttribute("data-product-id");

    if (!appUrl || !shop || !productId) {
      root.innerHTML = '<p class="imagyn-reviews__error">Reviews are not configured for this block.</p>';
      return;
    }

    var endpoint =
      appUrl.replace(/\/$/, "") +
      "/api/reviews?shop=" +
      encodeURIComponent(shop) +
      "&productId=" +
      encodeURIComponent(productId);

    fetch(endpoint, { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Request failed");
        }
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          throw new Error((data && data.error) || "Unable to load reviews");
        }
        render(root, data);
      })
      .catch(function () {
        root.innerHTML = '<p class="imagyn-reviews__error">Reviews are unavailable right now.</p>';
      });
  });
})();
