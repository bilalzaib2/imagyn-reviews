(function () {
  // Same App Proxy requirement as every other widget script — Shopify's proxy layer
  // appends `shop` (plus the signature it verifies) to every proxied request automatically;
  // this never needs to add it itself. See reviews-widget.js's own header comment.
  var PROXY_PATH = "/apps/reviews/featured";

  var renderStars = window.ImagynShared.renderStars;

  // Same reduced-motion guard rating-badge.js/reviews-widget.js apply to their own
  // scroll-into-view calls — per STOREFRONT_DESIGN_SYSTEM.md §10, every transition in
  // this system (including a nav-driven scroll) needs a reduced-motion variant. Autoplay
  // is stronger than a transition — unsolicited continuous motion is exactly what
  // prefers-reduced-motion exists to prevent — so autoplay is disabled entirely below,
  // not just de-animated.
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value === null || value === undefined ? "" : String(value);
    return div.innerHTML;
  }

  // Same short-date format reviews-widget.js's own formatDate uses, for visual consistency
  // between the two review-card renderers.
  function formatDate(value) {
    try {
      return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (error) {
      return "";
    }
  }

  // Mirrors reviews-widget.js's renderVerifiedBadge exactly (same filled-circle-with-
  // cutout-check icon, same imagyn-review-card__verified-icon/-label classes, same
  // "Verified Buyer" label) — kept as its own small copy rather than a cross-script
  // import, matching this extension's existing convention of each widget script being
  // self-contained (see rating-badge.js/collection-rating-badges.js, which don't share
  // helpers with reviews-widget.js either beyond window.ImagynShared/ImagynAppearance).
  function renderVerifiedBadge(review) {
    if (!review.verifiedPurchase) {
      return "";
    }
    return (
      '<span class="imagyn-review-card__verified">' +
      '<svg class="imagyn-review-card__verified-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
      '<circle cx="10" cy="10" r="10" fill="currentColor"></circle>' +
      '<path d="M6 10.4 8.7 13 14 7.5" stroke="var(--imagyn-color-surface, #fff)" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>' +
      "</svg>" +
      '<span class="imagyn-review-card__verified-label">Verified Buyer</span>' +
      "</span>"
    );
  }

  var CHEVRON_LEFT = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Reads the block's Theme Editor settings straight off the container's data attributes —
  // same convention data-heading/data-review-count already established. A boolean checkbox
  // setting serializes as the literal string "true"/"false" in Liquid; only an explicit
  // "false" turns a flag off, so a missing/unexpected attribute value fails open (matches
  // every show_* default being true in the schema).
  function readSettings(container) {
    function bool(name, fallback) {
      var value = container.getAttribute(name);
      if (value === null) return fallback;
      return value !== "false";
    }

    var autoplaySpeed = parseFloat(container.getAttribute("data-autoplay-speed"));

    return {
      showRating: bool("data-show-rating", true),
      showDate: bool("data-show-date", true),
      showName: bool("data-show-name", true),
      showImages: bool("data-show-images", true),
      showVideo: bool("data-show-video", true),
      showProduct: bool("data-show-product", true),
      showArrows: bool("data-show-arrows", true),
      showDots: bool("data-show-dots", false),
      autoplay: bool("data-autoplay", false),
      autoplaySpeed: isFinite(autoplaySpeed) && autoplaySpeed > 0 ? autoplaySpeed : 5,
    };
  }

  function renderSlide(review, settings) {
    var html = '<li class="imagyn-carousel__slide" data-review-id="' + escapeHtml(review.id) + '">';
    html += '<div class="imagyn-review-card">';

    var identity = "";
    if (settings.showName) {
      identity += '<span class="imagyn-review-card__name">' + escapeHtml(review.reviewerName) + "</span>";
    }
    identity += renderVerifiedBadge(review);

    if (identity || settings.showDate) {
      html += '<div class="imagyn-review-card__header">';
      if (identity) {
        html += '<span class="imagyn-review-card__identity">' + identity + "</span>";
      }
      if (settings.showDate) {
        html += '<span class="imagyn-review-card__date">' + formatDate(review.createdAt) + "</span>";
      }
      html += "</div>";
    }

    if (settings.showRating) {
      html += '<span class="imagyn-review-card__stars" aria-hidden="true">' + renderStars(review.rating) + "</span>";
      html += '<span class="imagyn-visually-hidden">Rated ' + review.rating + " out of 5 stars</span>";
    }

    if (review.title) {
      html += '<p class="imagyn-review-card__title">' + escapeHtml(review.title) + "</p>";
    }
    html += '<p class="imagyn-review-card__body">' + escapeHtml(review.content) + "</p>";

    // At most one photo/video per slide — a carousel card is a compact preview, not the
    // full review detail (the Product Reviews Widget's gallery/lightbox already covers
    // that). show_images/show_video are independent toggles, so a review with both photo
    // and video media respects whichever of the two the merchant left enabled.
    var eligibleMedia = (review.media || []).filter(function (item) {
      return item.type === "VIDEO" ? settings.showVideo : settings.showImages;
    });
    if (eligibleMedia.length > 0) {
      var firstMedia = eligibleMedia[0];
      html +=
        '<img class="imagyn-carousel__media" src="' +
        escapeHtml(firstMedia.thumbnailUrl || firstMedia.url) +
        '" alt="" loading="lazy" />';
    }

    if (settings.showProduct && review.product) {
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

  // How many slides are actually visible at once right now — derived from real rendered
  // geometry (slide width + track gap), not re-read from the cards-per-breakpoint settings,
  // so it stays correct at any viewport width without duplicating the CSS media-query logic.
  function getVisibleCount(track) {
    var slide = track.querySelector(".imagyn-carousel__slide");
    if (!slide || !track.clientWidth) return 1;
    var slideWidth = slide.getBoundingClientRect().width;
    if (slideWidth <= 0) return 1;
    var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return Math.max(1, Math.round((track.clientWidth + gap) / (slideWidth + gap)));
  }

  function initCarousel(container) {
    var heading = container.getAttribute("data-heading") || "";
    var limit = container.getAttribute("data-review-count") || "12";
    var settings = readSettings(container);

    var viewport = container.querySelector("[data-imagyn-carousel-viewport]");
    var track = container.querySelector("[data-imagyn-carousel-track]");
    var controls = container.querySelector("[data-imagyn-carousel-controls]");
    var dotsContainer = container.querySelector("[data-imagyn-carousel-dots]");

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

        track.innerHTML = reviews
          .map(function (review) {
            return renderSlide(review, settings);
          })
          .join("");

        if (reviews.length <= 1) {
          return;
        }

        var reduceMotionBehavior = reduceMotion ? "auto" : "smooth";

        var scrollAmount = function () {
          var firstSlide = track.querySelector(".imagyn-carousel__slide");
          return firstSlide ? firstSlide.getBoundingClientRect().width + 16 : track.clientWidth * 0.8;
        };

        var goPrev = function () {
          track.scrollBy({ left: -scrollAmount(), behavior: reduceMotionBehavior });
        };
        var goNext = function () {
          // Wrap back to the start once scrolled (close enough to) the end — makes
          // autoplay loop indefinitely instead of stalling at the last card.
          var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
          if (atEnd) {
            track.scrollTo({ left: 0, behavior: reduceMotionBehavior });
          } else {
            track.scrollBy({ left: scrollAmount(), behavior: reduceMotionBehavior });
          }
        };

        if (settings.showArrows) {
          controls.innerHTML =
            '<button type="button" class="imagyn-carousel__nav" data-imagyn-carousel-prev aria-label="Previous reviews">' + CHEVRON_LEFT + "</button>" +
            '<button type="button" class="imagyn-carousel__nav" data-imagyn-carousel-next aria-label="Next reviews">' + CHEVRON_RIGHT + "</button>";

          controls.querySelector("[data-imagyn-carousel-prev]").addEventListener("click", goPrev);
          controls.querySelector("[data-imagyn-carousel-next]").addEventListener("click", goNext);
        }

        // Pagination dots — one dot per "page" of currently-visible cards, not one per
        // review (a 12-review carousel showing 4 at a time is 3 pages, not 12 dots).
        // Recomputed on resize since the cards-per-breakpoint settings change how many
        // reviews make up a page at different viewport widths.
        if (settings.showDots) {
          var dotButtons = [];

          var renderDots = function () {
            var visibleCount = getVisibleCount(track);
            var pageCount = Math.max(1, Math.ceil(reviews.length / visibleCount));
            var html = "";
            for (var i = 0; i < pageCount; i++) {
              html +=
                '<button type="button" class="imagyn-carousel__dot" data-page="' + i + '" aria-label="Go to reviews page ' + (i + 1) + '"></button>';
            }
            dotsContainer.innerHTML = pageCount > 1 ? html : "";
            dotButtons = Array.prototype.slice.call(dotsContainer.querySelectorAll("[data-page]"));
            dotButtons.forEach(function (dot) {
              dot.addEventListener("click", function () {
                var page = Number(dot.getAttribute("data-page"));
                track.scrollTo({ left: page * track.clientWidth, behavior: reduceMotionBehavior });
              });
            });
            updateActiveDot();
          };

          var updateActiveDot = function () {
            if (!dotButtons.length || !track.clientWidth) return;
            var activePage = Math.round(track.scrollLeft / track.clientWidth);
            dotButtons.forEach(function (dot, index) {
              var isActive = index === activePage;
              dot.classList.toggle("imagyn-carousel__dot--active", isActive);
              if (isActive) {
                dot.setAttribute("aria-current", "true");
              } else {
                dot.removeAttribute("aria-current");
              }
            });
          };

          var scrollTicking = false;
          track.addEventListener(
            "scroll",
            function () {
              if (scrollTicking) return;
              scrollTicking = true;
              window.requestAnimationFrame(function () {
                updateActiveDot();
                scrollTicking = false;
              });
            },
            { passive: true },
          );

          renderDots();

          var resizeTimer;
          window.addEventListener("resize", function () {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(renderDots, 150);
          });
        }

        // Autoplay never starts under prefers-reduced-motion, full stop — not just a
        // de-animated version of it (see the reduceMotion comment at the top of this
        // file). Pauses on hover/focus so a shopper reading a card doesn't have it
        // scroll out from under them mid-read; resumes when they move away.
        if (settings.autoplay && !reduceMotion) {
          var autoplayTimer = null;
          var startAutoplay = function () {
            if (autoplayTimer) return;
            autoplayTimer = window.setInterval(goNext, settings.autoplaySpeed * 1000);
          };
          var stopAutoplay = function () {
            window.clearInterval(autoplayTimer);
            autoplayTimer = null;
          };

          startAutoplay();
          container.addEventListener("pointerenter", stopAutoplay);
          container.addEventListener("pointerleave", startAutoplay);
          container.addEventListener("focusin", stopAutoplay);
          container.addEventListener("focusout", startAutoplay);
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
