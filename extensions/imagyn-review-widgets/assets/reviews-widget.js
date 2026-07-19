(function () {
  // Requests must go through Shopify's App Proxy (same-origin, on the shop's own domain)
  // so the app can verify Shopify actually signed them — a direct cross-origin fetch to
  // the app's own domain would never carry a valid signature and is rejected server-side.
  var PROXY_PATH = "/apps/reviews";

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

  // Reads this block instance's own native Shopify theme-editor settings (added alongside
  // the Widget Builder settings, not replacing them). Only non-empty values are included,
  // so an untouched color setting doesn't blank out the Widget Builder's saved color.
  // Checkbox/select settings always have a value in Shopify's schema (they can't be left
  // "unset"), so those always apply for this block instance — that's expected native block
  // behavior, still scoped to just this block, never touching the Widget Builder's data.
  function readThemeOverrides(root) {
    var overrides = {};

    var starColor = root.getAttribute("data-star-color");
    if (starColor) overrides.starColor = starColor;

    var backgroundColor = root.getAttribute("data-background-color");
    if (backgroundColor) overrides.backgroundColor = backgroundColor;

    var borderColor = root.getAttribute("data-border-color");
    if (borderColor) overrides.borderColor = borderColor;

    var buttonColor = root.getAttribute("data-button-color");
    if (buttonColor) overrides.buttonColor = buttonColor;

    var borderRadius = parseFloat(root.getAttribute("data-border-radius"));
    if (!isNaN(borderRadius)) overrides.borderRadius = borderRadius;

    var headingFontSize = parseFloat(root.getAttribute("data-heading-font-size"));
    if (!isNaN(headingFontSize)) overrides.headingFontSize = headingFontSize;

    var bodyFontSize = parseFloat(root.getAttribute("data-body-font-size"));
    if (!isNaN(bodyFontSize)) overrides.bodyFontSize = bodyFontSize;

    var showAverageRating = root.getAttribute("data-show-average-rating");
    if (showAverageRating === "true" || showAverageRating === "false") {
      overrides.showAverageRating = showAverageRating === "true";
    }

    var showReviewCount = root.getAttribute("data-show-review-count");
    if (showReviewCount === "true" || showReviewCount === "false") {
      overrides.showReviewCount = showReviewCount === "true";
    }

    var showWriteReviewButton = root.getAttribute("data-show-write-review-button");
    if (showWriteReviewButton === "true" || showWriteReviewButton === "false") {
      overrides.showWriteReviewButton = showWriteReviewButton === "true";
    }

    var showLoadMoreButton = root.getAttribute("data-show-load-more-button");
    if (showLoadMoreButton === "true" || showLoadMoreButton === "false") {
      overrides.showLoadMoreButton = showLoadMoreButton === "true";
    }

    var reviewsPerPage = parseInt(root.getAttribute("data-reviews-per-page"), 10);
    if (!isNaN(reviewsPerPage) && reviewsPerPage > 0) {
      overrides.reviewsPerPage = reviewsPerPage;
    }

    var layout = root.getAttribute("data-layout");
    if (layout) overrides.layout = layout;

    return overrides;
  }

  // Maps the merchant's saved Widget settings (widget.server.ts / widget.shared.ts —
  // unmodified) onto CSS custom properties consumed by reviews-widget.css, so the
  // storefront widget reflects the same builder configuration shown in the admin. Any
  // value also set via this block's own theme-editor settings overrides it, but only for
  // this block instance — the Widget Builder's saved settings themselves are untouched.
  function resolveSettings(widget, themeOverrides) {
    var s = {};
    if (widget && widget.settings) {
      for (var key in widget.settings) {
        if (Object.prototype.hasOwnProperty.call(widget.settings, key)) {
          s[key] = widget.settings[key];
        }
      }
    }
    for (var overrideKey in themeOverrides) {
      if (Object.prototype.hasOwnProperty.call(themeOverrides, overrideKey)) {
        s[overrideKey] = themeOverrides[overrideKey];
      }
    }
    return s;
  }

  function applyStyle(root, s) {
    var style = root.style;

    style.setProperty("--imagyn-star-color", s.starColor);
    style.setProperty("--imagyn-text-color", s.textColor);
    style.setProperty("--imagyn-background-color", s.backgroundColor);
    style.setProperty("--imagyn-border-color", s.borderColor);
    style.setProperty("--imagyn-border-radius", s.borderRadius + "px");
    style.setProperty("--imagyn-heading-font-size", s.headingFontSize + "px");
    style.setProperty("--imagyn-body-font-size", s.bodyFontSize + "px");
    style.setProperty("--imagyn-button-color", s.buttonColor);

    root.classList.remove("imagyn-reviews--layout-list", "imagyn-reviews--layout-grid", "imagyn-reviews--layout-carousel");
    root.classList.add("imagyn-reviews--layout-" + (s.layout || "list"));
  }

  function renderList(listEl, data, s, visibleCount, onLoadMore) {
    var summary = data.summary || { averageRating: 0, totalReviews: 0 };
    var reviews = data.reviews || [];

    var summaryHtml = "";
    if (s.showAverageRating !== false || s.showReviewCount !== false) {
      summaryHtml += '<div class="imagyn-reviews__summary">';
      if (s.showAverageRating !== false) {
        summaryHtml +=
          '<span class="imagyn-reviews__stars" aria-hidden="true">' + renderStars(summary.averageRating) + "</span>" +
          '<span class="imagyn-reviews__average">' + summary.averageRating.toFixed(1) + "</span>";
      }
      if (s.showReviewCount !== false) {
        summaryHtml +=
          '<span class="imagyn-reviews__count">(' +
          summary.totalReviews +
          (summary.totalReviews === 1 ? " review" : " reviews") +
          ")</span>";
      }
      summaryHtml += "</div>";
    }

    var visibleReviews = reviews.slice(0, visibleCount);

    var listHtml;
    if (reviews.length === 0) {
      listHtml = '<p class="imagyn-reviews__empty">No reviews yet.</p>';
    } else {
      listHtml =
        '<ul class="imagyn-reviews__list">' +
        visibleReviews
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

      if (s.showLoadMoreButton !== false && visibleReviews.length < reviews.length) {
        listHtml += '<button type="button" class="imagyn-reviews__load-more" data-imagyn-load-more>Load more</button>';
      }
    }

    listEl.innerHTML = summaryHtml + listHtml;

    var loadMoreBtn = listEl.querySelector("[data-imagyn-load-more]");
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", onLoadMore);
    }
  }

  function loadList(root, listEl, endpoint, themeOverrides) {
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

        var s = resolveSettings(data.widget, themeOverrides);
        applyStyle(root, s);

        var pageSize = s.reviewsPerPage > 0 ? s.reviewsPerPage : (data.reviews || []).length;
        var visibleCount = pageSize;

        function render() {
          renderList(listEl, data, s, visibleCount, function () {
            visibleCount += pageSize;
            render();
          });
        }

        render();
      })
      .catch(function () {
        listEl.innerHTML = '<p class="imagyn-reviews__error">Reviews are unavailable right now.</p>';
      });
  }

  function renderWriteReview(writeEl, context, showWriteReviewButton) {
    if (showWriteReviewButton === false) {
      writeEl.innerHTML = "";
      return;
    }

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

      fetch(PROXY_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
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

  // Scoped to `scope` so the Theme Editor's section re-render (see below) only
  // (re-)initializes the block instance that actually changed, not every one on the page.
  // The data-imagyn-initialized guard stops a block from being wired up twice.
  function init(scope) {
    (scope || document).querySelectorAll("[data-imagyn-reviews]:not([data-imagyn-initialized])").forEach(function (root) {
      root.setAttribute("data-imagyn-initialized", "true");

      // The product is detected automatically from Shopify's own `product` Liquid object
      // (available on any product template) — the block has no product picker to configure.
      var productId = root.getAttribute("data-product-id");
      var listEl = root.querySelector("[data-imagyn-list]");
      var writeEl = root.querySelector("[data-imagyn-write]");
      var themeOverrides = readThemeOverrides(root);

      if (!productId) {
        if (listEl) {
          listEl.innerHTML = '<p class="imagyn-reviews__error">Reviews are not configured for this block.</p>';
        }
        return;
      }

      if (listEl) {
        var endpoint = PROXY_PATH + "?productId=" + encodeURIComponent(productId);
        loadList(root, listEl, endpoint, themeOverrides);
      }

      if (writeEl) {
        renderWriteReview(writeEl, { productId: productId }, themeOverrides.showWriteReviewButton);
      }
    });
  }

  init();

  // Shopify's Theme Editor swaps in new section HTML via AJAX whenever a merchant edits
  // this block's settings; that swap doesn't re-run <script> tags, so without this listener
  // the widget would only ever reflect whatever HTML existed on the editor's first load.
  document.addEventListener("shopify:section:load", function (event) {
    init(event.target);
  });
})();
