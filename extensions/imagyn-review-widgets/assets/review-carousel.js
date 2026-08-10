(function () {
  // Same App Proxy requirement as every other widget script — Shopify's proxy layer
  // appends `shop` (plus the signature it verifies) to every proxied request automatically;
  // this never needs to add it itself. See reviews-widget.js's own header comment.
  var PROXY_PATH = "/apps/reviews/featured";

  var renderStars = window.ImagynShared.renderStars;

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value === null || value === undefined ? "" : String(value);
    return div.innerHTML;
  }

  function formatDate(value) {
    try {
      return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (error) {
      return "";
    }
  }

  // Mirrors reviews-widget.js's renderVerifiedBadge exactly (a small check icon + quiet
  // text, never a colored pill) — kept as its own small copy rather than a cross-script
  // import, matching this extension's existing convention of each widget script being
  // self-contained (see rating-badge.js/collection-rating-badges.js, which don't share
  // helpers with reviews-widget.js either beyond window.ImagynShared/ImagynAppearance).
  function renderVerifiedBadge(review) {
    if (!review.verifiedPurchase) {
      return "";
    }
    return (
      '<span class="imagyn-review-card__verified">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" width="12" height="12"><path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z"></path></svg>' +
      "<span>Verified</span>" +
      "</span>"
    );
  }

  var CHEVRON_LEFT = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderSlide(review) {
    var html = '<li class="imagyn-carousel__slide" data-review-id="' + escapeHtml(review.id) + '">';
    html += '<div class="imagyn-review-card">';

    html += '<div class="imagyn-review-card__header">';
    html += '<span class="imagyn-review-card__identity">';
    html += '<span class="imagyn-review-card__name">' + escapeHtml(review.reviewerName) + "</span>";
    html += renderVerifiedBadge(review);
    html += "</span>";
    html += '<span class="imagyn-review-card__date">' + formatDate(review.createdAt) + "</span>";
    html += "</div>";

    html += '<span class="imagyn-review-card__stars" aria-hidden="true">' + renderStars(review.rating) + "</span>";
    html += '<span class="imagyn-visually-hidden">Rated ' + review.rating + " out of 5 stars</span>";

    if (review.title) {
      html += '<p class="imagyn-review-card__title">' + escapeHtml(review.title) + "</p>";
    }
    html += '<p class="imagyn-review-card__body">' + escapeHtml(review.content) + "</p>";

    // At most one photo per slide — a carousel card is a compact preview, not the full
    // review detail (the Product Reviews Widget's gallery/lightbox already covers that).
    if (review.media && review.media.length > 0) {
      var firstMedia = review.media[0];
      html +=
        '<img class="imagyn-carousel__media" src="' +
        escapeHtml(firstMedia.thumbnailUrl || firstMedia.url) +
        '" alt="" loading="lazy" />';
    }

    if (review.product) {
      var productUrl = review.product.handle ? "/products/" + encodeURIComponent(review.product.handle) : null;
      var productInner =
        (review.product.featuredImage
          ? '<img class="imagyn-carousel__product-image" src="' + escapeHtml(review.product.featuredImage) + '" alt="" loading="lazy" />'
          : "") + '<span class="imagyn-carousel__product-name">' + escapeHtml(review.product.name) + "</span>";

      html += productUrl
        ? '<a class="imagyn-carousel__product" href="' + escapeHtml(productUrl) + '">' + productInner + "</a>"
        : '<div class="imagyn-carousel__product">' + productInner + "</div>";
    }

    html += "</div></li>";
    return html;
  }

  // Shown immediately on init, replaced the moment real data (or the empty/error state)
  // arrives — approximates the real slide's shape (imagyn-component-skeleton.css's
  // reserved primitives, the same ones reviews-widget.js's renderSummarySkeleton already
  // uses) rather than a generic spinner, so there's no layout jump when content lands.
  function renderCarouselSkeleton(track) {
    var slide =
      '<li class="imagyn-carousel__slide" aria-hidden="true">' +
      '<div class="imagyn-review-card">' +
      '<div class="imagyn-skeleton imagyn-skeleton--title"></div>' +
      '<div class="imagyn-skeleton imagyn-skeleton--text" style="width:90%"></div>' +
      '<div class="imagyn-skeleton imagyn-skeleton--text" style="width:70%"></div>' +
      "</div>" +
      "</li>";
    track.innerHTML = slide + slide + slide;
  }

  function initCarousel(container) {
    var heading = container.getAttribute("data-heading") || "";
    var limit = container.getAttribute("data-review-count") || "12";

    var viewport = container.querySelector("[data-imagyn-carousel-viewport]");
    var track = container.querySelector("[data-imagyn-carousel-track]");
    var controls = container.querySelector("[data-imagyn-carousel-controls]");

    renderCarouselSkeleton(track);

    fetch(PROXY_PATH + "?limit=" + encodeURIComponent(limit), { headers: { Accept: "application/json" } })
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

        if (window.ImagynAppearance) {
          window.ImagynAppearance.apply(data.appearance, container);
        }

        var reviews = data.reviews || [];

        // Empty state: hide the whole section rather than showing a fake/locked
        // placeholder — matches renderAiSummary/renderMedals's own convention in
        // reviews-widget.js.
        if (reviews.length === 0) {
          container.innerHTML = "";
          return;
        }

        if (heading) {
          var headingEl = document.createElement("p");
          headingEl.className = "imagyn-carousel__heading";
          headingEl.textContent = heading;
          container.insertBefore(headingEl, viewport);
        }

        track.innerHTML = reviews.map(renderSlide).join("");

        if (reviews.length > 1) {
          controls.innerHTML =
            '<button type="button" class="imagyn-carousel__nav" data-imagyn-carousel-prev aria-label="Previous reviews">' + CHEVRON_LEFT + "</button>" +
            '<button type="button" class="imagyn-carousel__nav" data-imagyn-carousel-next aria-label="Next reviews">' + CHEVRON_RIGHT + "</button>";

          var scrollAmount = function () {
            var firstSlide = track.querySelector(".imagyn-carousel__slide");
            return firstSlide ? firstSlide.getBoundingClientRect().width + 16 : track.clientWidth * 0.8;
          };

          controls.querySelector("[data-imagyn-carousel-prev]").addEventListener("click", function () {
            track.scrollBy({ left: -scrollAmount(), behavior: "smooth" });
          });
          controls.querySelector("[data-imagyn-carousel-next]").addEventListener("click", function () {
            track.scrollBy({ left: scrollAmount(), behavior: "smooth" });
          });
        }
      })
      .catch(function () {
        // Fails quietly — a broken/unavailable carousel disappears rather than showing an
        // error block on a homepage where a shopper has no write-a-review-style recovery
        // action available anyway (contrast reviews-widget.js's product-page error state,
        // which does show a message since that page's reviews are the primary content).
        container.innerHTML = "";
      });
  }

  function init() {
    var containers = document.querySelectorAll("[data-imagyn-carousel]");
    for (var i = 0; i < containers.length; i++) {
      initCarousel(containers[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
