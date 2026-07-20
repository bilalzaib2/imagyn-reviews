(function () {
  // Requests must go through Shopify's App Proxy (same-origin, on the shop's own domain)
  // so the app can verify Shopify actually signed them — a direct cross-origin fetch to
  // the app's own domain would never carry a valid signature and is rejected server-side.
  var PROXY_PATH = "/apps/reviews";

  var MAX_REVIEW_IMAGES = 10;
  var MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
  var ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

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

  // A persistent anonymous identifier for "Was this helpful?" voting — this is what the
  // (reviewId, visitorId) uniqueness constraint on the backend actually keys off of, not
  // a Shopify customer id (the widget has no customer auth). Falls back to a session-only
  // id when storage is unavailable (private browsing, disabled storage, etc.) so voting
  // still works, just without persisting the visitor's choice across page loads.
  function getVisitorId() {
    var storageKey = "imagynVisitorId";
    var randomId = function () {
      if (window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
      }
      return "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    };

    try {
      var existing = window.localStorage.getItem(storageKey);
      if (existing) return existing;
      var generated = randomId();
      window.localStorage.setItem(storageKey, generated);
      return generated;
    } catch (error) {
      return randomId();
    }
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

  // Review Summary component (STOREFRONT_ARCHITECTURE.md): a pure renderer of
  // averageRating/totalReviews/ratingCounts, no internal state, no events. The visual
  // hero of the widget per STOREFRONT_DESIGN_SYSTEM.md §16 — large numeral, accent star
  // row, review count, recommendation percentage, and the rating Histogram.

  // Skeleton shown synchronously on init, before the network response arrives — approximates
  // the hero's real layout per §11, not a generic box. Purely presentational, aria-hidden
  // (the real content that replaces it carries its own accessible text).
  function renderSummarySkeleton(summaryEl) {
    var rows = "";
    var widths = ["92%", "78%", "55%", "34%", "18%"];
    for (var i = 0; i < 5; i++) {
      rows += '<div class="imagyn-skeleton imagyn-skeleton--text" style="width:' + widths[i] + '"></div>';
    }

    summaryEl.innerHTML =
      '<div class="imagyn-summary" aria-hidden="true">' +
      '<div class="imagyn-summary__hero imagyn-summary__hero-skeleton">' +
      '<div class="imagyn-skeleton imagyn-skeleton--title"></div>' +
      '<div class="imagyn-skeleton imagyn-skeleton--text"></div>' +
      "</div>" +
      '<div class="imagyn-summary__histogram-skeleton">' +
      rows +
      "</div>" +
      "</div>";
  }

  // Bars render at 0% and are animated to their target width right after insertion (see
  // animateHistogramFills) — this is the "skeleton-to-content" motion exception
  // STOREFRONT_DESIGN_SYSTEM.md §10 sanctions, not an on-load animation of its own.
  function renderHistogram(ratingCounts, totalReviews) {
    var maxCount = 0;
    for (var star = 1; star <= 5; star++) {
      if (ratingCounts[star] > maxCount) maxCount = ratingCounts[star];
    }

    var rows = "";
    for (var value = 5; value >= 1; value--) {
      var count = ratingCounts[value] || 0;
      var fillPercent = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;

      rows +=
        '<div class="imagyn-histogram__row">' +
        '<span class="imagyn-histogram__label" aria-hidden="true">' + value + "</span>" +
        '<span class="imagyn-histogram__track">' +
        '<span class="imagyn-histogram__fill" aria-hidden="true" data-target-fill="' + fillPercent +
        '" style="--imagyn-histogram-fill: 0%"></span>' +
        "</span>" +
        '<span class="imagyn-histogram__count" aria-hidden="true">' + count + "</span>" +
        '<span class="imagyn-visually-hidden">' +
        value + (value === 1 ? " star" : " stars") + ": " + count + (count === 1 ? " review" : " reviews") +
        "</span>" +
        "</div>";
    }

    return '<div class="imagyn-histogram">' + rows + "</div>";
  }

  // Double rAF: setting the CSS variable in the same frame the element is inserted lets
  // the browser coalesce both styles into one paint, silently skipping the transition.
  // Waiting a frame guarantees the 0% state has actually painted before the target value
  // is applied. No-op under prefers-reduced-motion — the transition itself is disabled
  // via CSS there, so this just jumps straight to the final width instead of animating.
  function animateHistogramFills(summaryEl) {
    var fills = summaryEl.querySelectorAll("[data-target-fill]");
    if (fills.length === 0) return;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        for (var i = 0; i < fills.length; i++) {
          fills[i].style.setProperty("--imagyn-histogram-fill", fills[i].getAttribute("data-target-fill") + "%");
        }
      });
    });
  }

  // The Write a Review trigger (quickbar) is independent of the rating-display
  // settings and of review count — per STOREFRONT_DESIGN_SYSTEM.md §12, "the Write a
  // Review affordance stays fully present regardless of review count," which held
  // before this trigger moved here (it used to live in its own always-rendered DOM
  // region) and must keep holding now that it's part of this element's output.
  function renderAiSummary(aiSummary) {
    if (!aiSummary || !aiSummary.summary) {
      return "";
    }

    var html = '<div class="imagyn-ai-summary">';
    html += '<p class="imagyn-ai-summary__heading"><span aria-hidden="true">✨</span> AI Review Summary</p>';
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

  // The inline rating summary (stars, numeral, count, and the Write a Review trigger) has
  // moved to the Rating Badge block, positioned above the product title to match the
  // native Shopify/Atoms pattern (see rating-badge.js) — this component now covers only
  // the detailed breakdown (histogram, AI summary) and no longer duplicates those stats.
  // A second, independent Write a Review trigger is still offered here too, right beside
  // the rating — both it and the badge's trigger control the same underlying form (see the
  // "imagyn:write-review-toggle"/"imagyn:write-review-state" events below), so opening or
  // closing the form from either place keeps both buttons' state in sync.
  function renderSummary(summaryEl, summary, s, aiSummary) {
    var totalReviews = summary.totalReviews || 0;
    var averageRating = summary.averageRating || 0;
    var ratingCounts = summary.ratingCounts || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    var showStats = totalReviews > 0 && (s.showAverageRating !== false || s.showReviewCount !== false);
    var showWrite = s.showWriteReviewButton !== false;
    var recommendPercent = totalReviews > 0 ? Math.round(((ratingCounts[5] || 0) + (ratingCounts[4] || 0)) / totalReviews * 100) : 0;
    var hasEmptyState = totalReviews === 0;

    if (!showStats && !hasEmptyState && !aiSummary && !showWrite) {
      summaryEl.innerHTML = "";
      return;
    }

    var html = '<div class="imagyn-summary imagyn-fade-in">';

    if (showStats) {
      var srSummary =
        "Average rating " + averageRating.toFixed(1) + " out of 5 stars, based on " +
        totalReviews + (totalReviews === 1 ? " review" : " reviews") + ". " +
        recommendPercent + "% of customers recommend this product.";
      html += '<span class="imagyn-visually-hidden">' + escapeHtml(srSummary) + "</span>";
    }

    if (showWrite) {
      var formEl = document.querySelector("[data-imagyn-form]");
      var formOpen = !!(formEl && !formEl.hasAttribute("hidden"));
      html +=
        '<div class="imagyn-summary__quickbar">' +
        '<button type="button" class="imagyn-summary__quickbar-write" data-imagyn-summary-write aria-expanded="' +
        (formOpen ? "true" : "false") +
        '">Write a review</button>' +
        "</div>";
    }

    if (hasEmptyState) {
      html += '<p class="imagyn-empty-state">No reviews yet — be the first to share your experience.</p>';
    } else if (showStats) {
      // One cohesive "stats cluster" — overall rating, then the distribution that explains
      // it, then the recommendation stat derived from it — sharing a tight internal rhythm
      // (.imagyn-summary__hero's own gap), distinct from the more generous gap .imagyn-summary
      // uses to separate this whole cluster from AI Summary/Customer Photos/etc.
      //
      // aria-hidden goes on the headline and recommend line individually (both fully
      // redundant with the sr-only summary sentence above), NOT on the hero wrapper itself
      // — the Histogram in between has its own real per-star sr-only text (see
      // renderHistogram) that a wrapper-level aria-hidden would silence.
      html += '<div class="imagyn-summary__hero">';
      html += '<div class="imagyn-summary__headline" aria-hidden="true">';

      if (s.showAverageRating !== false) {
        html += '<span class="imagyn-summary__rating">' + averageRating.toFixed(1) + "</span>";
      }

      if (s.showReviewCount !== false) {
        html +=
          '<span class="imagyn-summary__count">' +
          totalReviews + (totalReviews === 1 ? " review" : " reviews") +
          "</span>";
      }
      html += "</div>"; // headline

      html += renderHistogram(ratingCounts, totalReviews);

      html +=
        '<p class="imagyn-summary__recommend" aria-hidden="true">' +
        recommendPercent + "% of customers recommend this product</p>";
      html += "</div>"; // hero
    }

    // Cache-only: aiSummary is whatever the reviews endpoint already had stored (see
    // getAiSummary — a pure read, never a generation trigger), so this never adds latency
    // or blocks rendering. Renders nothing at all until a merchant has generated one.
    html += renderAiSummary(aiSummary);

    html += "</div>"; // summary

    summaryEl.innerHTML = html;

    var summaryWriteBtn = summaryEl.querySelector("[data-imagyn-summary-write]");
    if (summaryWriteBtn) {
      summaryWriteBtn.addEventListener("click", function () {
        document.dispatchEvent(new CustomEvent("imagyn:write-review-toggle"));
      });
      document.addEventListener("imagyn:write-review-state", function (event) {
        summaryWriteBtn.setAttribute("aria-expanded", event.detail && event.detail.expanded ? "true" : "false");
      });
    }

    if (totalReviews > 0 && showStats) {
      animateHistogramFills(summaryEl);
    }
  }

  // Minimal outline thumb icons (Feather Icons' thumbs-up/thumbs-down glyphs — MIT-licensed
  // generic iconography) rather than emoji, so the helpful row reads as quiet UI chrome
  // instead of a decorative flourish. aria-hidden: the button's own aria-label already
  // carries the meaning; the visible count text is what sighted users read.
  var THUMBS_UP_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  var THUMBS_DOWN_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

  // Bottom-right of each review, per spec: "Was this helpful?" plus a thumb-icon/count
  // pair. Vote clicks are handled by a single delegated listener on listEl (see loadList),
  // not here — this only renders the current state (count + whether this visitor already
  // voted this way), since renderList re-runs on every "load more" click and re-attaching
  // a listener per button on every render would leak duplicate handlers.
  function renderHelpfulRow(review) {
    var helpfulCount = review.helpfulCount || 0;
    var notHelpfulCount = review.notHelpfulCount || 0;
    var myVote = review.myVote || null;
    var helpfulActive = myVote === "HELPFUL";
    var notHelpfulActive = myVote === "NOT_HELPFUL";

    return (
      '<div class="imagyn-review-card__helpful">' +
      '<span class="imagyn-review-card__helpful-label">Was this helpful?</span>' +
      '<button type="button" class="imagyn-review-card__helpful-btn' + (helpfulActive ? " imagyn-review-card__helpful-btn--active" : "") + '" ' +
      'data-helpful-vote="HELPFUL" aria-pressed="' + (helpfulActive ? "true" : "false") + '" aria-label="Mark this review as helpful">' +
      THUMBS_UP_ICON + '<span data-helpful-count="HELPFUL">' + helpfulCount + "</span>" +
      "</button>" +
      '<button type="button" class="imagyn-review-card__helpful-btn' + (notHelpfulActive ? " imagyn-review-card__helpful-btn--active" : "") + '" ' +
      'data-helpful-vote="NOT_HELPFUL" aria-pressed="' + (notHelpfulActive ? "true" : "false") + '" aria-label="Mark this review as not helpful">' +
      THUMBS_DOWN_ICON + '<span data-helpful-count="NOT_HELPFUL">' + notHelpfulCount + "</span>" +
      "</button>" +
      "</div>"
    );
  }

  // Shared by the aggregated Media Gallery and every Review Card's inline photo row: one
  // overlay instance, lazily created and reused for the page, per STOREFRONT_DESIGN_SYSTEM.md
  // §16 — arrow-key navigation, Escape to close, focus trapped while open, native swipe on
  // touch. `items` is a plain array of { url, alt }; the caller owns what "photo N of the
  // review" vs "photo N of the gallery" means, this only ever renders whatever it's given.
  function createLightbox() {
    var overlay = document.createElement("div");
    overlay.className = "imagyn-lightbox-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Photo viewer");
    overlay.innerHTML =
      '<div class="imagyn-lightbox">' +
      '<img class="imagyn-lightbox__image" alt="">' +
      '<button type="button" class="imagyn-lightbox__nav imagyn-lightbox__nav--prev" aria-label="Previous photo">‹</button>' +
      '<button type="button" class="imagyn-lightbox__nav imagyn-lightbox__nav--next" aria-label="Next photo">›</button>' +
      '<button type="button" class="imagyn-lightbox__close" aria-label="Close">×</button>' +
      '<span class="imagyn-lightbox__counter" data-imagyn-lightbox-counter></span>' +
      "</div>";
    document.body.appendChild(overlay);

    var imageEl = overlay.querySelector(".imagyn-lightbox__image");
    var prevBtn = overlay.querySelector(".imagyn-lightbox__nav--prev");
    var nextBtn = overlay.querySelector(".imagyn-lightbox__nav--next");
    var closeBtn = overlay.querySelector(".imagyn-lightbox__close");
    var counterEl = overlay.querySelector("[data-imagyn-lightbox-counter]");

    var items = [];
    var currentIndex = 0;
    var lastFocusedElement = null;
    var touchStartX = null;

    // A quiet cross-fade between photos rather than an abrupt swap — the loading class is
    // added right before the src changes (see show()) and removed once the new image has
    // actually decoded, so the fade-in always reflects real load state, not a fixed timer.
    imageEl.addEventListener("load", function () {
      imageEl.classList.remove("imagyn-lightbox__image--loading");
    });

    function show(index) {
      if (items.length === 0) return;
      currentIndex = (index + items.length) % items.length;
      var item = items[currentIndex];
      imageEl.classList.add("imagyn-lightbox__image--loading");
      imageEl.src = item.url;
      imageEl.alt = item.alt || "Customer photo";
      var multiple = items.length > 1;
      prevBtn.style.display = multiple ? "" : "none";
      nextBtn.style.display = multiple ? "" : "none";
      counterEl.style.display = multiple ? "" : "none";
      counterEl.textContent = (currentIndex + 1) + " of " + items.length;
    }

    function getFocusable() {
      return [closeBtn, prevBtn, nextBtn].filter(function (el) {
        return el.style.display !== "none";
      });
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        show(currentIndex - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        show(currentIndex + 1);
      } else if (event.key === "Tab") {
        var focusable = getFocusable();
        if (focusable.length === 0) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    function onTouchStart(event) {
      touchStartX = event.touches && event.touches.length === 1 ? event.touches[0].clientX : null;
    }

    function onTouchEnd(event) {
      if (touchStartX === null) return;
      var endX = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0].clientX : touchStartX;
      var delta = endX - touchStartX;
      touchStartX = null;
      if (Math.abs(delta) < 40) return;
      show(delta > 0 ? currentIndex - 1 : currentIndex + 1);
    }

    function open(nextItems, startIndex, triggerEl) {
      if (!nextItems || nextItems.length === 0) return;
      items = nextItems;
      lastFocusedElement = triggerEl || document.activeElement;
      show(startIndex || 0);
      overlay.classList.add("imagyn-lightbox-overlay--open");
      document.addEventListener("keydown", onKeyDown);
      closeBtn.focus();
    }

    function close() {
      overlay.classList.remove("imagyn-lightbox-overlay--open");
      document.removeEventListener("keydown", onKeyDown);
      imageEl.src = "";
      if (lastFocusedElement && lastFocusedElement.focus) {
        lastFocusedElement.focus();
      }
    }

    closeBtn.addEventListener("click", close);
    prevBtn.addEventListener("click", function () {
      show(currentIndex - 1);
    });
    nextBtn.addEventListener("click", function () {
      show(currentIndex + 1);
    });
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    overlay.addEventListener("touchstart", onTouchStart, { passive: true });
    overlay.addEventListener("touchend", onTouchEnd, { passive: true });

    return { open: open };
  }

  var sharedLightbox = null;
  function getLightbox() {
    if (!sharedLightbox) {
      sharedLightbox = createLightbox();
    }
    return sharedLightbox;
  }

  // Single place that turns one ReviewMedia item into a thumbnail button — both the
  // aggregated Media Gallery and each Review Card's inline photo row call through here,
  // so adding video support later (item.type is already IMAGE|VIDEO — see the Prisma
  // schema) only means branching once, right here, rather than in every renderer that
  // touches media. Today every item is an image, so there's nothing to branch on yet.
  function renderMediaThumb(item, index, total, itemClass, imageClass) {
    return (
      '<button type="button" class="' +
      itemClass +
      '" data-media-index="' +
      index +
      '" aria-label="View photo ' + (index + 1) + " of " + total + '">' +
      '<img class="' + imageClass + '" src="' + escapeHtml(item.thumbnailUrl || item.url) + '" alt="" loading="lazy">' +
      "</button>"
    );
  }

  function mediaToLightboxItems(items) {
    return items.map(function (item) {
      return { url: item.url, alt: "Customer photo" };
    });
  }

  // The aggregated, product-level Media Gallery — every customer photo across this
  // product's approved reviews, one horizontal strip above the review list (distinct from
  // each Review Card's own inline photo row, rendered separately in renderList). Renders
  // nothing when there are no photos yet, same "render nothing" rule as the rest of this
  // widget's optional sections.
  function renderGallery(galleryEl, items) {
    if (!items || items.length === 0) {
      galleryEl.innerHTML = "";
      return;
    }

    var html =
      '<div class="imagyn-media-gallery">' +
      '<p class="imagyn-ratings-section__label">Customer photos</p>' +
      '<div class="imagyn-media-gallery__track" role="list">' +
      items
        .map(function (item, index) {
          return renderMediaThumb(item, index, items.length, "imagyn-media-gallery__item", "imagyn-media-gallery__image");
        })
        .join("") +
      "</div>" +
      "</div>";

    galleryEl.innerHTML = html;

    var lightboxItems = mediaToLightboxItems(items);

    Array.prototype.forEach.call(galleryEl.querySelectorAll("[data-media-index]"), function (btn) {
      btn.addEventListener("click", function () {
        getLightbox().open(lightboxItems, Number(btn.getAttribute("data-media-index")), btn);
      });
    });
  }

  // Per-review thumbnail row, rendered beneath a review's body text when it has photos —
  // per STOREFRONT_DESIGN_SYSTEM.md §16's Media Gallery rule. Click handling is delegated
  // on listEl (see loadList) rather than wired here, matching the helpful-vote buttons.
  function renderReviewMedia(review) {
    if (!review.media || review.media.length === 0) {
      return "";
    }

    return (
      '<div class="imagyn-review-media">' +
      '<div class="imagyn-review-media__track">' +
      review.media
        .map(function (item, index) {
          return renderMediaThumb(item, index, review.media.length, "imagyn-review-media__item", "imagyn-review-media__image");
        })
        .join("") +
      "</div>" +
      "</div>"
    );
  }

  function renderList(listEl, data, s, visibleCount, onLoadMore) {
    var reviews = data.reviews || [];
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
              '<li class="imagyn-review-card" data-review-id="' + escapeHtml(review.id) + '">' +
              '<div class="imagyn-review-card__header">' +
              '<span class="imagyn-review-card__name">' + escapeHtml(review.reviewerName) + "</span>" +
              '<span class="imagyn-review-card__date">' + formatDate(review.createdAt) + "</span>" +
              "</div>" +
              '<span class="imagyn-review-card__stars" aria-hidden="true">' + renderStars(review.rating) + "</span>" +
              '<span class="imagyn-visually-hidden">Rated ' + review.rating + " out of 5 stars</span>" +
              (review.title
                ? '<p class="imagyn-review-card__title">' + escapeHtml(review.title) + "</p>"
                : "") +
              '<p class="imagyn-review-card__body">' + escapeHtml(review.content) + "</p>" +
              renderReviewMedia(review) +
              '<div class="imagyn-review-card__footer">' + renderHelpfulRow(review) + "</div>" +
              "</li>"
            );
          })
          .join("") +
        "</ul>";

      if (s.showLoadMoreButton !== false && visibleReviews.length < reviews.length) {
        listHtml += '<button type="button" class="imagyn-reviews__load-more" data-imagyn-load-more>Load more</button>';
      }
    }

    listEl.innerHTML = listHtml;

    var loadMoreBtn = listEl.querySelector("[data-imagyn-load-more]");
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", onLoadMore);
    }
  }

  function applyHelpfulRowState(row, review) {
    var helpfulBtn = row.querySelector('[data-helpful-vote="HELPFUL"]');
    var notHelpfulBtn = row.querySelector('[data-helpful-vote="NOT_HELPFUL"]');
    var helpfulActive = review.myVote === "HELPFUL";
    var notHelpfulActive = review.myVote === "NOT_HELPFUL";

    if (helpfulBtn) {
      helpfulBtn.querySelector('[data-helpful-count="HELPFUL"]').textContent = review.helpfulCount || 0;
      helpfulBtn.classList.toggle("imagyn-review-card__helpful-btn--active", helpfulActive);
      helpfulBtn.setAttribute("aria-pressed", helpfulActive ? "true" : "false");
    }
    if (notHelpfulBtn) {
      notHelpfulBtn.querySelector('[data-helpful-count="NOT_HELPFUL"]').textContent = review.notHelpfulCount || 0;
      notHelpfulBtn.classList.toggle("imagyn-review-card__helpful-btn--active", notHelpfulActive);
      notHelpfulBtn.setAttribute("aria-pressed", notHelpfulActive ? "true" : "false");
    }
  }

  // Optimistic: the UI updates immediately from locally-computed counts, then is
  // reconciled with the server's authoritative counts on success (never trusting the
  // optimistic math as final), or rolled back to the exact pre-vote state on failure.
  // `getReview` reads live data so this keeps working correctly after a sort change
  // swaps in a whole new review array, without needing to be re-wired.
  function handleHelpfulVote(button, getReview, visitorId) {
    var row = button.closest("[data-review-id]");
    if (!row) return;

    var reviewId = row.getAttribute("data-review-id");
    var review = getReview(reviewId);
    if (!review) return;

    var newVote = button.getAttribute("data-helpful-vote");
    if (review.myVote === newVote) return;

    var previous = {
      myVote: review.myVote || null,
      helpfulCount: review.helpfulCount || 0,
      notHelpfulCount: review.notHelpfulCount || 0,
    };

    var nextHelpful = previous.helpfulCount;
    var nextNotHelpful = previous.notHelpfulCount;
    if (previous.myVote === "HELPFUL") nextHelpful -= 1;
    if (previous.myVote === "NOT_HELPFUL") nextNotHelpful -= 1;
    if (newVote === "HELPFUL") nextHelpful += 1;
    if (newVote === "NOT_HELPFUL") nextNotHelpful += 1;

    review.myVote = newVote;
    review.helpfulCount = nextHelpful;
    review.notHelpfulCount = nextNotHelpful;
    applyHelpfulRowState(row, review);

    fetch(PROXY_PATH + "/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ reviewId: reviewId, visitorId: visitorId, vote: newVote }),
    })
      .then(function (response) {
        return response.json().then(function (json) {
          return { ok: response.ok, data: json };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.data || !result.data.ok) {
          throw new Error((result.data && result.data.error) || "Unable to record vote.");
        }

        review.helpfulCount = result.data.helpfulCount;
        review.notHelpfulCount = result.data.notHelpfulCount;
        review.myVote = result.data.vote;
        applyHelpfulRowState(row, review);
      })
      .catch(function () {
        review.myVote = previous.myVote;
        review.helpfulCount = previous.helpfulCount;
        review.notHelpfulCount = previous.notHelpfulCount;
        applyHelpfulRowState(row, review);
      });
  }

  // "Filters & Sorting" in the section hierarchy — chip-based Filters aren't built yet
  // anywhere in this app (per STOREFRONT_DESIGN_SYSTEM.md, still a documented future
  // component), so this is Sorting alone today; the wrapper and heading stay so Filters can
  // land here later without moving anything else.
  function renderSortControl(sortEl, currentSort, onChange) {
    sortEl.innerHTML =
      '<div class="imagyn-reviews__filters-row">' +
      '<p class="imagyn-ratings-section__label">Filters &amp; Sorting</p>' +
      '<label class="imagyn-reviews__sort">' +
      '<span class="imagyn-reviews__sort-label">Sort by</span>' +
      '<select class="imagyn-reviews__sort-select" data-imagyn-sort-select>' +
      '<option value="recent"' + (currentSort === "recent" ? " selected" : "") + ">Most Recent</option>" +
      '<option value="helpful"' + (currentSort === "helpful" ? " selected" : "") + ">Most Helpful</option>" +
      "</select>" +
      "</label>" +
      "</div>";

    sortEl.querySelector("[data-imagyn-sort-select]").addEventListener("change", function (event) {
      onChange(event.target.value);
    });
  }

  function loadList(root, summaryEl, galleryEl, listEl, sortEl, baseEndpoint, themeOverrides, visitorId) {
    // Mutable across the whole widget instance's lifetime — the delegated vote listener
    // below is attached exactly once but always needs to read whichever review array is
    // currently loaded, including after a sort change swaps in a brand new fetch.
    var currentData = null;

    function findReview(reviewId) {
      var reviews = (currentData && currentData.reviews) || [];
      for (var i = 0; i < reviews.length; i++) {
        if (reviews[i].id === reviewId) return reviews[i];
      }
      return null;
    }

    listEl.addEventListener("click", function (event) {
      var voteBtn = event.target.closest ? event.target.closest("[data-helpful-vote]") : null;
      if (voteBtn) {
        handleHelpfulVote(voteBtn, findReview, visitorId);
        return;
      }

      var mediaBtn = event.target.closest ? event.target.closest("[data-media-index]") : null;
      if (mediaBtn) {
        var row = mediaBtn.closest("[data-review-id]");
        var review = row ? findReview(row.getAttribute("data-review-id")) : null;
        if (!review || !review.media) return;

        getLightbox().open(mediaToLightboxItems(review.media), Number(mediaBtn.getAttribute("data-media-index")), mediaBtn);
      }
    });

    function fetchAndRender(sort) {
      if (summaryEl) {
        renderSummarySkeleton(summaryEl);
      }

      var endpoint = baseEndpoint + "&visitorId=" + encodeURIComponent(visitorId) + "&sort=" + encodeURIComponent(sort);

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

          currentData = data;

          var s = resolveSettings(data.widget, themeOverrides);
          applyStyle(root, s);

          if (summaryEl) {
            renderSummary(
              summaryEl,
              data.summary || { averageRating: 0, totalReviews: 0, ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
              s,
              data.aiSummary || null,
            );
          }

          if (galleryEl) {
            renderGallery(galleryEl, data.gallery || []);
          }

          if (sortEl) {
            if ((data.reviews || []).length > 0) {
              renderSortControl(sortEl, sort, function (nextSort) {
                fetchAndRender(nextSort);
              });
            } else {
              sortEl.innerHTML = "";
            }
          }

          var pageSize = s.reviewsPerPage > 0 ? s.reviewsPerPage : (data.reviews || []).length;
          var visibleCount = pageSize;

          function render() {
            renderList(listEl, currentData, s, visibleCount, function () {
              visibleCount += pageSize;
              render();
            });
          }

          render();
        })
        .catch(function () {
          listEl.innerHTML = '<p class="imagyn-reviews__error">Reviews are unavailable right now.</p>';
          if (sortEl) {
            sortEl.innerHTML = "";
          }
          if (galleryEl) {
            galleryEl.innerHTML = "";
          }
          // Rating/count can't be shown without the failed response's data, but Write a
          // Review must stay available regardless (the Rating Badge above the title offers
          // it too, fetching independently, but this widget's own trigger shouldn't
          // disappear just because the list request failed).
          if (summaryEl) {
            var s = resolveSettings(null, themeOverrides);
            if (s.showWriteReviewButton !== false) {
              var formEl = document.querySelector("[data-imagyn-form]");
              var formOpen = !!(formEl && !formEl.hasAttribute("hidden"));
              summaryEl.innerHTML =
                '<div class="imagyn-summary imagyn-fade-in">' +
                '<div class="imagyn-summary__quickbar">' +
                '<button type="button" class="imagyn-summary__quickbar-write" data-imagyn-summary-write aria-expanded="' +
                (formOpen ? "true" : "false") +
                '">Write a review</button>' +
                "</div>" +
                "</div>";

              var summaryWriteBtn = summaryEl.querySelector("[data-imagyn-summary-write]");
              summaryWriteBtn.addEventListener("click", function () {
                document.dispatchEvent(new CustomEvent("imagyn:write-review-toggle"));
              });
              document.addEventListener("imagyn:write-review-state", function (event) {
                summaryWriteBtn.setAttribute("aria-expanded", event.detail && event.detail.expanded ? "true" : "false");
              });
            } else {
              summaryEl.innerHTML = "";
            }
          }
        });
    }

    fetchAndRender("recent");
  }

  // The trigger for this form lives in the separate Rating Badge block, above the product
  // title (see rating-badge.js) — this listens for its "imagyn:write-review-toggle" custom
  // event on `document` rather than a direct reference, since the two blocks are
  // independent and may not even both be present on every page.
  function renderWriteReview(root, writeEl, context, showWriteReviewButton) {
    if (showWriteReviewButton === false) {
      writeEl.innerHTML = "";
      return;
    }

    writeEl.innerHTML =
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
      '<div class="imagyn-reviews__field">' +
      '<label for="imagyn-reviews-photos">Add photos (optional)</label>' +
      '<input type="file" id="imagyn-reviews-photos" data-imagyn-photo-input accept="' +
      ALLOWED_IMAGE_TYPES.join(",") +
      '" multiple>' +
      '<p class="imagyn-reviews__photo-hint" data-imagyn-photo-hint>Up to ' +
      MAX_REVIEW_IMAGES +
      " photos, 5MB max each.</p>" +
      '<div class="imagyn-reviews__photo-previews" data-imagyn-photo-previews></div>' +
      "</div>" +
      '<div class="imagyn-reviews__upload-progress" data-imagyn-upload-progress hidden>' +
      '<div class="imagyn-reviews__upload-progress-bar" data-imagyn-upload-progress-bar></div>' +
      "</div>" +
      '<p class="imagyn-reviews__form-error" data-imagyn-form-error hidden></p>' +
      '<p class="imagyn-reviews__form-success" data-imagyn-form-success hidden></p>' +
      '<button type="submit" class="imagyn-reviews__submit" data-imagyn-submit>Submit review</button>' +
      "</form>";

    var form = writeEl.querySelector("[data-imagyn-form]");
    var errorEl = writeEl.querySelector("[data-imagyn-form-error]");
    var successEl = writeEl.querySelector("[data-imagyn-form-success]");
    var submitBtn = writeEl.querySelector("[data-imagyn-submit]");
    var starButtons = Array.prototype.slice.call(writeEl.querySelectorAll("[data-rating-value]"));
    var selectedRating = 0;

    var photoInput = writeEl.querySelector("[data-imagyn-photo-input]");
    var photoPreviewsEl = writeEl.querySelector("[data-imagyn-photo-previews]");
    var progressEl = writeEl.querySelector("[data-imagyn-upload-progress]");
    var progressBarEl = writeEl.querySelector("[data-imagyn-upload-progress-bar]");
    // { file, previewUrl } — client-managed rather than trusting input.files directly, since
    // the input is reset after every change event so the same file can be re-picked and so
    // rejected files never silently linger in the native selection.
    var selectedPhotos = [];

    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    document.addEventListener("imagyn:write-review-toggle", function () {
      var isHidden = form.hasAttribute("hidden");
      if (isHidden) {
        form.removeAttribute("hidden");
        form.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      } else {
        form.setAttribute("hidden", "");
      }
      document.dispatchEvent(new CustomEvent("imagyn:write-review-state", { detail: { expanded: isHidden } }));
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

    function renderPhotoPreviews() {
      photoPreviewsEl.innerHTML = selectedPhotos
        .map(function (item, index) {
          return (
            '<div class="imagyn-reviews__photo-preview">' +
            '<img src="' + item.previewUrl + '" alt="Selected photo ' + (index + 1) + '">' +
            '<button type="button" class="imagyn-reviews__photo-remove" data-remove-photo-index="' +
            index +
            '" aria-label="Remove photo ' + (index + 1) + '">×</button>' +
            "</div>"
          );
        })
        .join("");
    }

    photoInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(photoInput.files || []);
      // Reset immediately so the browser doesn't keep rejected/duplicate files selected,
      // and so picking the same file again later re-fires the change event.
      photoInput.value = "";

      var rejectionMessage = null;

      files.forEach(function (file) {
        if (selectedPhotos.length >= MAX_REVIEW_IMAGES) {
          rejectionMessage = "You can add up to " + MAX_REVIEW_IMAGES + " photos.";
          return;
        }
        if (ALLOWED_IMAGE_TYPES.indexOf(file.type) === -1) {
          rejectionMessage = file.name + ": unsupported file type.";
          return;
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          rejectionMessage = file.name + ": file exceeds the 5MB limit.";
          return;
        }
        selectedPhotos.push({ file: file, previewUrl: URL.createObjectURL(file) });
      });

      renderPhotoPreviews();
      if (rejectionMessage) {
        showError(rejectionMessage);
      }
    });

    photoPreviewsEl.addEventListener("click", function (event) {
      var removeBtn = event.target.closest ? event.target.closest("[data-remove-photo-index]") : null;
      if (!removeBtn) return;

      var index = Number(removeBtn.getAttribute("data-remove-photo-index"));
      var removed = selectedPhotos.splice(index, 1)[0];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      renderPhotoPreviews();
    });

    function resetPhotos() {
      selectedPhotos.forEach(function (item) {
        URL.revokeObjectURL(item.previewUrl);
      });
      selectedPhotos = [];
      renderPhotoPreviews();
    }

    function showUploadProgress(percent) {
      progressEl.removeAttribute("hidden");
      progressBarEl.style.width = percent + "%";
    }

    function hideUploadProgress() {
      progressEl.setAttribute("hidden", "");
      progressBarEl.style.width = "0%";
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
      showUploadProgress(0);

      var formData = new FormData();
      formData.append("productId", context.productId);
      formData.append("rating", String(selectedRating));
      formData.append("customerName", customerName);
      formData.append("customerEmail", fieldValue("customerEmail"));
      formData.append("title", fieldValue("title"));
      formData.append("content", content);
      selectedPhotos.forEach(function (item) {
        formData.append("images", item.file, item.file.name);
      });

      // XMLHttpRequest rather than fetch: fetch has no upload-progress event, and this is
      // the one submission in the widget large enough (multi-image uploads) to need one.
      var xhr = new XMLHttpRequest();
      xhr.open("POST", PROXY_PATH, true);
      xhr.responseType = "json";

      xhr.upload.addEventListener("progress", function (event) {
        if (event.lengthComputable) {
          showUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      xhr.addEventListener("load", function () {
        hideUploadProgress();
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit review";

        var data = xhr.response;
        if (xhr.status < 200 || xhr.status >= 300 || !data || !data.ok) {
          showError((data && data.error) || "Unable to submit review.");
          return;
        }

        form.reset();
        selectedRating = 0;
        paintStars();
        resetPhotos();

        var message = "Thanks! Your review has been submitted and is awaiting approval.";
        if (data.media && data.media.failed && data.media.failed.length > 0) {
          message +=
            " " + data.media.failed.length + (data.media.failed.length === 1 ? " photo" : " photos") +
            " could not be uploaded.";
        }
        successEl.textContent = message;
        successEl.removeAttribute("hidden");
      });

      xhr.addEventListener("error", function () {
        hideUploadProgress();
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit review";
        showError("Unable to submit review.");
      });

      xhr.send(formData);
    });
  }

  // Shopify app blocks can only be inserted into whatever section a merchant drops them
  // into — there's no way for an app to register a new top-level section a merchant places
  // independently. This section needs to be full-width, below the entire product info (not
  // squeezed into a theme's narrow, often position:sticky info column), so instead it
  // relocates itself once: every Shopify section, on any Online Store 2.0 theme, is wrapped
  // by the platform in an element whose id starts with "shopify-section-" — walking up to
  // the nearest one and reinserting right after it puts this section at the top level of the
  // page, wherever the merchant originally placed the block. Runs synchronously before first
  // paint, so there's no visible flash. If no such ancestor exists (a non-standard theme),
  // the section just stays where the merchant placed it and still works, only narrower.
  function relocateRatingsSection(root) {
    var section = root.closest("[data-imagyn-ratings-section]");
    if (!section || section.hasAttribute("data-imagyn-relocated")) return;
    section.setAttribute("data-imagyn-relocated", "true");

    var anchor = section.closest('[id^="shopify-section-"]');
    if (!anchor) return;

    anchor.insertAdjacentElement("afterend", section);
  }

  // Reserved seam for per-attribute ratings (e.g. "Quality 4.8", "Comfort 4.5") — no such
  // data exists yet (no schema, no review-form fields), so this intentionally renders
  // nothing, matching this widget's "render nothing until there's real content" rule rather
  // than showing shoppers a "Coming soon" placeholder. When that data exists, it renders
  // into this element, in this position in the hierarchy (between AI Summary and Customer
  // Photos), without moving anything else.
  function renderAttributeRatings(attributesEl) {
    if (!attributesEl) return;
    attributesEl.innerHTML = "";
  }

  // Scoped to `scope` so the Theme Editor's section re-render (see below) only
  // (re-)initializes the block instance that actually changed, not every one on the page.
  // The data-imagyn-initialized guard stops a block from being wired up twice.
  function init(scope) {
    (scope || document).querySelectorAll("[data-imagyn-reviews]:not([data-imagyn-initialized])").forEach(function (root) {
      root.setAttribute("data-imagyn-initialized", "true");
      relocateRatingsSection(root);

      // The product is detected automatically from Shopify's own `product` Liquid object
      // (available on any product template) — the block has no product picker to configure.
      var productId = root.getAttribute("data-product-id");
      var summaryEl = root.querySelector("[data-imagyn-summary]");
      var attributesEl = root.querySelector("[data-imagyn-attributes]");
      var galleryEl = root.querySelector("[data-imagyn-gallery]");
      var sortEl = root.querySelector("[data-imagyn-sort]");
      var listEl = root.querySelector("[data-imagyn-list]");
      var writeEl = root.querySelector("[data-imagyn-write]");
      var themeOverrides = readThemeOverrides(root);

      renderAttributeRatings(attributesEl);

      if (!productId) {
        if (listEl) {
          listEl.innerHTML = '<p class="imagyn-reviews__error">Reviews are not configured for this block.</p>';
        }
        return;
      }

      if (listEl) {
        var visitorId = getVisitorId();
        var endpoint = PROXY_PATH + "?productId=" + encodeURIComponent(productId);
        loadList(root, summaryEl, galleryEl, listEl, sortEl, endpoint, themeOverrides, visitorId);
      }

      if (writeEl) {
        renderWriteReview(root, writeEl, { productId: productId }, themeOverrides.showWriteReviewButton);
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
