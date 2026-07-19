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

  function renderList(listEl, data) {
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

    listEl.innerHTML = summaryHtml + listHtml;
  }

  function loadList(listEl, endpoint) {
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
        renderList(listEl, data);
      })
      .catch(function () {
        listEl.innerHTML = '<p class="imagyn-reviews__error">Reviews are unavailable right now.</p>';
      });
  }

  function renderWriteReview(writeEl, context) {
    writeEl.innerHTML =
      '<button type="button" class="imagyn-reviews__write-toggle" data-imagyn-toggle>Write a Review</button>' +
      '<form class="imagyn-reviews__form" data-imagyn-form hidden>' +
      '<div class="imagyn-reviews__field">' +
      "<label>Rating</label>" +
      '<div class="imagyn-reviews__rating-picker" data-imagyn-rating-picker role="radiogroup" aria-label="Rating">' +
      [1, 2, 3, 4, 5]
        .map(function (value) {
          return (
            '<button type="button" class="imagyn-reviews__star-btn" data-rating-value="' +
            value +
            '" aria-label="' +
            value +
            " star" +
            (value > 1 ? "s" : "") +
            '" aria-pressed="false">☆</button>'
          );
        })
        .join("") +
      "</div>" +
      "</div>" +
      '<div class="imagyn-reviews__field">' +
      '<label for="imagyn-reviews-name">Name</label>' +
      '<input type="text" id="imagyn-reviews-name" data-imagyn-field="customerName" required>' +
      "</div>" +
      '<div class="imagyn-reviews__field">' +
      '<label for="imagyn-reviews-email">Email (optional)</label>' +
      '<input type="email" id="imagyn-reviews-email" data-imagyn-field="customerEmail">' +
      "</div>" +
      '<div class="imagyn-reviews__field">' +
      '<label for="imagyn-reviews-title">Title (optional)</label>' +
      '<input type="text" id="imagyn-reviews-title" data-imagyn-field="title">' +
      "</div>" +
      '<div class="imagyn-reviews__field">' +
      '<label for="imagyn-reviews-content">Review</label>' +
      '<textarea id="imagyn-reviews-content" data-imagyn-field="content" rows="4" required></textarea>' +
      "</div>" +
      '<p class="imagyn-reviews__form-error" data-imagyn-form-error hidden></p>' +
      '<p class="imagyn-reviews__form-success" data-imagyn-form-success hidden>' +
      "Thanks! Your review has been submitted and is awaiting approval." +
      "</p>" +
      '<button type="submit" class="imagyn-reviews__submit" data-imagyn-submit>Submit review</button>' +
      "</form>";

    var toggleBtn = writeEl.querySelector("[data-imagyn-toggle]");
    var form = writeEl.querySelector("[data-imagyn-form]");
    var errorEl = writeEl.querySelector("[data-imagyn-form-error]");
    var successEl = writeEl.querySelector("[data-imagyn-form-success]");
    var submitBtn = writeEl.querySelector("[data-imagyn-submit]");
    var starButtons = Array.prototype.slice.call(writeEl.querySelectorAll("[data-rating-value]"));
    var selectedRating = 0;

    toggleBtn.addEventListener("click", function () {
      var isHidden = form.hasAttribute("hidden");
      if (isHidden) {
        form.removeAttribute("hidden");
        toggleBtn.setAttribute("aria-expanded", "true");
      } else {
        form.setAttribute("hidden", "");
        toggleBtn.setAttribute("aria-expanded", "false");
      }
    });

    function paintStars() {
      starButtons.forEach(function (btn) {
        var value = Number(btn.getAttribute("data-rating-value"));
        var active = value <= selectedRating;
        btn.textContent = active ? "★" : "☆";
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    starButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        selectedRating = Number(btn.getAttribute("data-rating-value"));
        paintStars();
      });
    });

    function showError(message) {
      errorEl.textContent = message;
      errorEl.removeAttribute("hidden");
    }

    function hideError() {
      errorEl.setAttribute("hidden", "");
      errorEl.textContent = "";
    }

    function fieldValue(name) {
      var field = form.querySelector('[data-imagyn-field="' + name + '"]');
      return field ? field.value.trim() : "";
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      hideError();
      successEl.setAttribute("hidden", "");

      var customerName = fieldValue("customerName");
      var content = fieldValue("content");

      if (selectedRating < 1 || selectedRating > 5) {
        showError("Please select a rating.");
        return;
      }
      if (!customerName) {
        showError("Please enter your name.");
        return;
      }
      if (!content) {
        showError("Please write a review before submitting.");
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting…";

      var endpoint = context.appUrl.replace(/\/$/, "") + "/api/reviews";

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          shop: context.shop,
          productId: context.productId,
          rating: selectedRating,
          customerName: customerName,
          customerEmail: fieldValue("customerEmail"),
          title: fieldValue("title"),
          content: content,
        }),
      })
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok || !result.data || !result.data.ok) {
            throw new Error((result.data && result.data.error) || "Unable to submit review.");
          }

          form.reset();
          selectedRating = 0;
          paintStars();
          successEl.removeAttribute("hidden");
        })
        .catch(function (error) {
          showError(error.message || "Unable to submit review.");
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit review";
        });
    });
  }

  document.querySelectorAll("[data-imagyn-reviews]").forEach(function (root) {
    var appUrl = root.getAttribute("data-app-url");
    var shop = root.getAttribute("data-shop");
    var productId = root.getAttribute("data-product-id");
    var listEl = root.querySelector("[data-imagyn-list]");
    var writeEl = root.querySelector("[data-imagyn-write]");

    if (!appUrl || !shop || !productId) {
      if (listEl) {
        listEl.innerHTML = '<p class="imagyn-reviews__error">Reviews are not configured for this block.</p>';
      }
      return;
    }

    if (listEl) {
      var endpoint =
        appUrl.replace(/\/$/, "") +
        "/api/reviews?shop=" +
        encodeURIComponent(shop) +
        "&productId=" +
        encodeURIComponent(productId);
      loadList(listEl, endpoint);
    }

    if (writeEl) {
      renderWriteReview(writeEl, { appUrl: appUrl, shop: shop, productId: productId });
    }
  });
})();
