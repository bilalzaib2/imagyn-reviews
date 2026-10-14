(function () {
  "use strict";

  // Imagyn Reviews — Video Reviews Carousel (Pro).
  //
  // Renders real, approved customer video reviews from
  // app/routes/api.reviews.video-carousel.tsx. That endpoint is the Pro gate: on a store
  // without the entitlement it returns `locked: true` and an empty list, and this script
  // then renders nothing. There is no client-side entitlement flag to tamper with.
  //
  // Playback policy, deliberately conservative:
  //  - No autoplay, ever. Video starts only on an explicit user action.
  //  - Only one video plays at a time; starting one pauses the rest.
  //  - A video that scrolls out of view pauses itself.
  //  - `src` is attached on first play, not at render. Posters are all that load on first
  //    paint, so a carousel of twelve videos costs twelve images, not twelve video streams.

  var PROXY_PATH = "/apps/reviews/video-carousel";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value === null || value === undefined ? "" : String(value);
    return div.innerHTML;
  }

  function truncate(value, max) {
    var text = String(value || "");
    if (text.length <= max) return text;
    return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
  }

  // Mirrors ImagynShared.renderStars exactly, including the per-star elements that let the
  // unfilled glyph take --imagyn-color-star-empty (imagyn-utilities.css).
  function renderStars(rating) {
    var full = Math.round(rating);
    var stars = "";
    for (var i = 0; i < 5; i++) {
      stars += i < full
        ? '<span class="imagyn-star">★</span>'
        : '<span class="imagyn-star imagyn-star--empty">☆</span>';
    }
    return stars;
  }

  function flag(root, name, fallback) {
    var value = root.getAttribute(name);
    if (value === null || value === "") return fallback;
    return value !== "false";
  }

  // ------------------------------------------------------------------ card markup

  function renderCard(review, options) {
    var video = review.media && review.media[0];
    if (!video) return "";

    var poster = video.thumbnailUrl || (options.showProductImage ? review.product.featuredImage : null);

    var html = '<li class="imagyn-vcarousel__slide" role="group" aria-roledescription="slide">';
    html += '<article class="imagyn-vcarousel__card">';

    // Media. The <video> carries no src until play — see attachAndPlay.
    html += '<div class="imagyn-vcarousel__media">';
    html +=
      '<video class="imagyn-vcarousel__video" preload="none" playsinline controls ' +
      'data-imagyn-video data-src="' + escapeHtml(video.url) + '"' +
      (poster ? ' poster="' + escapeHtml(poster) + '"' : "") +
      // Labelled for screen readers by the reviewer + product this video belongs to, rather
      // than an anonymous "video" node.
      ' aria-label="' + escapeHtml("Video review of " + review.product.name + " by " + review.reviewerName) + '"' +
      "></video>";
    html +=
      '<button type="button" class="imagyn-vcarousel__play" data-imagyn-play ' +
      'aria-label="' + escapeHtml("Play video review by " + review.reviewerName) + '">' +
      '<span class="imagyn-vcarousel__play-icon" aria-hidden="true"></span>' +
      "</button>";
    // Replaces the player in place if the source fails, so a dead CDN URL degrades to a
    // readable card instead of a browser's broken-media chrome.
    html += '<p class="imagyn-vcarousel__media-error" data-imagyn-media-error hidden>This video isn’t available right now.</p>';
    html += "</div>";

    html += '<div class="imagyn-vcarousel__body">';

    if (options.showRating) {
      html +=
        '<p class="imagyn-vcarousel__rating" aria-label="' + escapeHtml(review.rating + " out of 5 stars") + '">' +
        '<span aria-hidden="true">' + renderStars(review.rating) + "</span></p>";
    }

    if (options.showText && review.content) {
      html += '<p class="imagyn-vcarousel__text">' + escapeHtml(truncate(review.content, options.textLength)) + "</p>";
    }

    if (options.showName || (options.showVerified && review.verifiedPurchase)) {
      html += '<p class="imagyn-vcarousel__meta">';
      if (options.showName) {
        html += '<span class="imagyn-vcarousel__name">' + escapeHtml(review.reviewerName) + "</span>";
      }
      // Rendered only when the review is genuinely verified against a real order — the
      // merchant's toggle can hide the badge but can never add it to an unverified review.
      if (options.showVerified && review.verifiedPurchase) {
        html += '<span class="imagyn-vcarousel__verified">Verified Buyer</span>';
      }
      html += "</p>";
    }

    if (options.showProduct && review.product && review.product.name) {
      var productInner = "";
      if (options.showProductImage && review.product.featuredImage) {
        productInner +=
          '<img class="imagyn-vcarousel__product-image" src="' + escapeHtml(review.product.featuredImage) +
          '" alt="" loading="lazy" width="32" height="32" />';
      }
      productInner += '<span class="imagyn-vcarousel__product-name">' + escapeHtml(review.product.name) + "</span>";

      html += review.product.handle
        ? '<a class="imagyn-vcarousel__product" href="/products/' + escapeHtml(review.product.handle) + '">' + productInner + "</a>"
        : '<p class="imagyn-vcarousel__product">' + productInner + "</p>";
    }

    html += "</div></article></li>";
    return html;
  }

  // ------------------------------------------------------------------ playback

  function pauseAll(root, except) {
    root.querySelectorAll("[data-imagyn-video]").forEach(function (video) {
      if (video !== except && !video.paused) {
        video.pause();
      }
      if (video !== except) {
        var card = video.closest(".imagyn-vcarousel__media");
        if (card) card.removeAttribute("data-playing");
      }
    });
  }

  function attachAndPlay(root, video) {
    // Only one stream at a time, and never more than the one the shopper asked for.
    pauseAll(root, video);

    if (!video.getAttribute("src")) {
      video.setAttribute("src", video.getAttribute("data-src") || "");
    }

    var media = video.closest(".imagyn-vcarousel__media");
    var play = video.play();
    if (play && typeof play.catch === "function") {
      play.catch(function () {
        // Autoplay policy, a codec the browser can't decode, or a dead URL — all of which
        // should surface as a readable message rather than a stuck spinner.
        if (media) {
          media.removeAttribute("data-playing");
          var error = media.querySelector("[data-imagyn-media-error]");
          if (error) error.hidden = false;
        }
      });
    }
    if (media) media.setAttribute("data-playing", "true");
  }

  // ------------------------------------------------------------------ carousel

  function setupCarousel(root, viewport, track, options) {
    var slides = Array.prototype.slice.call(track.children);
    if (slides.length === 0) return;

    var controls = root.querySelector("[data-imagyn-vcarousel-controls]");
    var dots = root.querySelector("[data-imagyn-vcarousel-dots]");

    function pageWidth() {
      return viewport.clientWidth;
    }

    function currentIndex() {
      var width = pageWidth();
      return width > 0 ? Math.round(viewport.scrollLeft / width) : 0;
    }

    function scrollToPage(index) {
      viewport.scrollTo({
        left: index * pageWidth(),
        // Honouring prefers-reduced-motion here matters more than usual: this is a wide
        // horizontal translation, the exact motion the setting exists to suppress.
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }

    var pageCount = 1;
    function recalcPages() {
      var width = pageWidth();
      pageCount = width > 0 ? Math.max(1, Math.ceil(track.scrollWidth / width)) : 1;
    }

    if (options.showArrows) {
      controls.hidden = false;
      controls.innerHTML =
        '<button type="button" class="imagyn-vcarousel__arrow" data-dir="prev" aria-label="Previous video reviews">←</button>' +
        '<button type="button" class="imagyn-vcarousel__arrow" data-dir="next" aria-label="Next video reviews">→</button>';

      controls.addEventListener("click", function (event) {
        var button = event.target.closest("[data-dir]");
        if (!button) return;
        var next = currentIndex() + (button.getAttribute("data-dir") === "next" ? 1 : -1);
        scrollToPage(Math.max(0, Math.min(pageCount - 1, next)));
      });
    }

    function renderDots() {
      if (!options.showDots) return;
      recalcPages();
      if (pageCount < 2) {
        dots.hidden = true;
        return;
      }
      dots.hidden = false;
      var active = currentIndex();
      var html = "";
      for (var i = 0; i < pageCount; i++) {
        html +=
          '<button type="button" class="imagyn-vcarousel__dot" data-page="' + i + '"' +
          ' aria-label="' + "Go to page " + (i + 1) + " of " + pageCount + '"' +
          (i === active ? ' aria-current="true"' : "") +
          "></button>";
      }
      dots.innerHTML = html;
    }

    if (options.showDots) {
      dots.addEventListener("click", function (event) {
        var dot = event.target.closest("[data-page]");
        if (dot) scrollToPage(Number(dot.getAttribute("data-page")));
      });
    }

    // Keyboard: the viewport is a focusable region, so arrow keys move between pages
    // without the shopper having to tab through every card first.
    viewport.setAttribute("tabindex", "0");
    viewport.setAttribute("role", "region");
    viewport.setAttribute("aria-roledescription", "carousel");
    viewport.setAttribute("aria-label", "Customer video reviews");
    viewport.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      var next = currentIndex() + (event.key === "ArrowRight" ? 1 : -1);
      scrollToPage(Math.max(0, Math.min(pageCount - 1, next)));
    });

    // Touch swipe is the browser's own overflow scrolling (scroll-snap in CSS) rather than a
    // hand-rolled drag handler — it is smoother, interruptible, and gets momentum for free.
    var scrollTimer = null;
    viewport.addEventListener(
      "scroll",
      function () {
        if (scrollTimer) window.clearTimeout(scrollTimer);
        scrollTimer = window.setTimeout(renderDots, 80);
      },
      { passive: true },
    );

    window.addEventListener("resize", function () {
      recalcPages();
      renderDots();
    });

    renderDots();
  }

  // ------------------------------------------------------------------ init

  function render(root, payload) {
    var track = root.querySelector("[data-imagyn-vcarousel-track]");
    var viewport = root.querySelector("[data-imagyn-vcarousel-viewport]");
    var header = root.querySelector("[data-imagyn-vcarousel-header]");

    var reviews = (payload && payload.reviews) || [];

    // `locked` (no Pro entitlement) and "no video reviews yet" are both non-errors, and both
    // resolve to the merchant's configured empty behaviour. A shopper must never see a
    // half-rendered widget or an upgrade prompt on a live storefront.
    if (reviews.length === 0) {
      if (root.getAttribute("data-empty-behavior") === "message" && !payload.locked) {
        var message = root.getAttribute("data-empty-message") || "";
        root.innerHTML = '<p class="imagyn-vcarousel__empty">' + escapeHtml(message) + "</p>";
      } else {
        root.setAttribute("hidden", "");
      }
      return;
    }

    var options = {
      showRating: flag(root, "data-show-rating", true),
      showName: flag(root, "data-show-name", true),
      showVerified: flag(root, "data-show-verified", true),
      showText: flag(root, "data-show-text", true),
      textLength: Number(root.getAttribute("data-text-length")) || 120,
      showProduct: flag(root, "data-show-product", true),
      showProductImage: flag(root, "data-show-product-image", true),
      showArrows: flag(root, "data-show-arrows", true),
      showDots: flag(root, "data-show-dots", true),
    };

    var heading = root.getAttribute("data-heading");
    var subheading = root.getAttribute("data-subheading");
    if (heading || subheading) {
      var headerHtml = "";
      if (heading) headerHtml += '<h2 class="imagyn-vcarousel__heading">' + escapeHtml(heading) + "</h2>";
      if (subheading) headerHtml += '<p class="imagyn-vcarousel__subheading">' + escapeHtml(subheading) + "</p>";
      header.innerHTML = headerHtml;
      header.hidden = false;
    }

    track.innerHTML = reviews
      .map(function (review) {
        return renderCard(review, options);
      })
      .join("");

    root.querySelectorAll("[data-imagyn-play]").forEach(function (button) {
      button.addEventListener("click", function () {
        var media = button.closest(".imagyn-vcarousel__media");
        var video = media && media.querySelector("[data-imagyn-video]");
        if (video) attachAndPlay(root, video);
      });
    });

    root.querySelectorAll("[data-imagyn-video]").forEach(function (video) {
      video.addEventListener("play", function () {
        pauseAll(root, video);
        var media = video.closest(".imagyn-vcarousel__media");
        if (media) media.setAttribute("data-playing", "true");
      });
      video.addEventListener("pause", function () {
        var media = video.closest(".imagyn-vcarousel__media");
        if (media) media.removeAttribute("data-playing");
      });
      video.addEventListener("error", function () {
        var media = video.closest(".imagyn-vcarousel__media");
        if (!media) return;
        media.removeAttribute("data-playing");
        var error = media.querySelector("[data-imagyn-media-error]");
        if (error) error.hidden = false;
      });
    });

    // A video that has scrolled out of view keeps playing audio otherwise — the single most
    // common complaint about video carousels.
    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting && !entry.target.paused) {
              entry.target.pause();
            }
          });
        },
        { threshold: 0.4 },
      );
      root.querySelectorAll("[data-imagyn-video]").forEach(function (video) {
        observer.observe(video);
      });
    }

    setupCarousel(root, viewport, track, options);
  }

  function init(scope) {
    (scope || document)
      .querySelectorAll("[data-imagyn-video-carousel]:not([data-imagyn-video-carousel-initialized])")
      .forEach(function (root) {
        root.setAttribute("data-imagyn-video-carousel-initialized", "true");

        var limit = Number(root.getAttribute("data-video-count")) || 12;

        fetch(PROXY_PATH + "?limit=" + encodeURIComponent(limit), { headers: { Accept: "application/json" } })
          .then(function (response) {
            if (!response.ok) throw new Error("Request failed");
            return response.json();
          })
          .then(function (payload) {
            if (!payload || !payload.ok) {
              root.setAttribute("hidden", "");
              return;
            }
            if (payload.appearance && window.ImagynAppearance) {
              window.ImagynAppearance.apply(payload.appearance);
            }
            render(root, payload);
          })
          .catch(function () {
            // Never leave a half-built widget on a live storefront.
            root.setAttribute("hidden", "");
          });
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init(document);
    });
  } else {
    init(document);
  }

  // Theme Editor re-renders a section without a full page load.
  document.addEventListener("shopify:section:load", function (event) {
    init(event.target);
  });
})();
