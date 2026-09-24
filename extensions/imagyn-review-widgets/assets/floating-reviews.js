(function () {
  // Same App Proxy convention as every other widget script — Shopify's proxy layer appends
  // `shop` (plus the signature it verifies) to every proxied request automatically. See
  // app/routes/api.reviews.floating.tsx and shopify.app.toml's [app_proxy] config (prefix
  // "apps", subpath "reviews" -> this resolves to /apps/reviews/floating).
  var PROXY_PATH = "/apps/reviews/floating";

  var renderStars = window.ImagynShared.renderStars;
  var escapeHtml = window.ImagynShared.escapeHtml;

  // Imagyn's own small brand mark, same inlined emblem store-reviews.js uses for its verified
  // indicator — currentColor so it follows the surrounding text color rather than painting a
  // fixed dark circle regardless of the merchant's theme.
  var VERIFIED_ICON =
    '<svg class="imagyn-floating-reviews__verified-icon" viewBox="0 0 54.86 54.58" aria-hidden="true" focusable="false">' +
    '<circle cx="27.46" cy="7.01" r="7.01" fill="currentColor"/>' +
    '<circle cx="27.4" cy="47.57" r="7.01" fill="currentColor"/>' +
    '<circle cx="47.85" cy="7.01" r="4.67" fill="currentColor"/>' +
    '<circle cx="47.85" cy="47.57" r="4.67" fill="currentColor"/>' +
    '<circle cx="47.85" cy="27.32" r="7.01" fill="currentColor"/>' +
    '<circle cx="7.01" cy="7.01" r="4.67" fill="currentColor"/>' +
    '<circle cx="7.01" cy="47.57" r="4.67" fill="currentColor"/>' +
    '<circle cx="7.01" cy="27.26" r="7.01" fill="currentColor"/>' +
    "</svg>";

  // "true"/"false" arrive as literal strings from Liquid's {{ block.settings.x }} — a real
  // boolean setting always renders one of those two words, never blank, so an explicit string
  // check (not truthy-string coercion, which treats "false" as truthy) is the correct read.
  // Same helper store-reviews.js uses.
  function isOn(value) {
    return value !== "false";
  }

  function formatDate(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function plural(count, singular, pluralWord) {
    return count === 1 ? singular : pluralWord;
  }

  // ---------------------------------------------------------------- Rendering

  function renderVerified() {
    return '<span class="imagyn-floating-reviews__verified">' + VERIFIED_ICON + "Verified</span>";
  }

  // Only real ReviewMedia rows of type "image" are rendered. Videos are deliberately skipped
  // here rather than rendered as a broken thumbnail: this compact drawer has no player, and
  // the full Product Reviews widget already handles video properly.
  function renderMedia(media) {
    if (!media || media.length === 0) {
      return "";
    }

    var html = "";
    for (var i = 0; i < media.length; i++) {
      var item = media[i];
      if (item.type !== "image") {
        continue;
      }
      var src = item.thumbnailUrl || item.url;
      if (!src) {
        continue;
      }
      html +=
        '<img class="imagyn-floating-reviews__media-item" src="' +
        escapeHtml(src) +
        '" alt="" loading="lazy" decoding="async" width="64" height="64">';
    }

    return html ? '<div class="imagyn-floating-reviews__media">' + html + "</div>" : "";
  }

  // Every field below is rendered only when the review actually has it: no invented titles, no
  // "Verified" on an unverified review, no placeholder body text. `visibility` is the block's
  // own Theme Editor settings for this instance.
  function renderReview(review, visibility, showProductName) {
    var html = '<li class="imagyn-floating-reviews__review">';

    html += '<div class="imagyn-floating-reviews__review-head">';
    html +=
      '<span class="imagyn-floating-reviews__review-stars" role="img" aria-label="' +
      review.rating +
      ' out of 5 stars">' +
      renderStars(review.rating) +
      "</span>";
    html += '<span class="imagyn-floating-reviews__review-author">' + escapeHtml(review.reviewerName) + "</span>";
    if (visibility.verified && review.verifiedPurchase) {
      html += renderVerified();
    }
    html += "</div>";

    if (review.title) {
      html += '<p class="imagyn-floating-reviews__review-title">' + escapeHtml(review.title) + "</p>";
    }

    html += '<p class="imagyn-floating-reviews__review-body">' + escapeHtml(review.content) + "</p>";

    if (visibility.media) {
      html += renderMedia(review.media);
    }

    // The merchant's own public reply, when there is one — same treatment the Product Reviews
    // widget gives it, so a shopper sees the store's answer in either place.
    if (review.reply) {
      html += '<div class="imagyn-floating-reviews__reply">';
      html += '<p class="imagyn-floating-reviews__reply-label">Store reply</p>';
      html += '<p class="imagyn-floating-reviews__reply-body">' + escapeHtml(review.reply) + "</p>";
      html += "</div>";
    }

    var meta = [];
    // Only useful on a store-wide drawer — on a product-scoped one every review is already
    // about the product named in the header.
    if (showProductName && review.productName) {
      meta.push(escapeHtml(review.productName));
    }
    var date = formatDate(review.createdAt);
    if (date) {
      meta.push(escapeHtml(date));
    }
    if (meta.length > 0) {
      html += '<p class="imagyn-floating-reviews__review-meta">' + meta.join(" · ") + "</p>";
    }

    html += "</li>";
    return html;
  }

  function renderPanelContents(data, settings, visibility) {
    var summary = data.summary;
    var total = summary.totalReviews || 0;
    var isProductScope = data.scope === "product" && data.productName;

    var html = '<div class="imagyn-floating-reviews__header">';
    html += '<div class="imagyn-floating-reviews__header-top">';
    html += "<div>";
    html +=
      '<h2 class="imagyn-floating-reviews__title" id="imagyn-floating-reviews-title">' +
      escapeHtml(settings.heading) +
      "</h2>";
    // Names exactly what the numbers below describe, so a store-wide fallback on a product
    // page is never mistaken for that product's own rating.
    html +=
      '<p class="imagyn-floating-reviews__scope">' +
      (isProductScope ? escapeHtml(data.productName) : "Across the whole store") +
      "</p>";
    html += "</div>";
    html +=
      '<button type="button" class="imagyn-floating-reviews__close" data-imagyn-floating-close aria-label="Close reviews">&times;</button>';
    html += "</div>";

    if (visibility.rating && total > 0) {
      html += '<div class="imagyn-floating-reviews__summary">';
      html += '<span class="imagyn-floating-reviews__average">' + summary.averageRating.toFixed(1) + "</span>";
      html +=
        '<span class="imagyn-floating-reviews__stars" role="img" aria-label="' +
        summary.averageRating.toFixed(1) +
        ' out of 5 stars">' +
        renderStars(summary.averageRating) +
        "</span>";
      if (visibility.count) {
        html +=
          '<span class="imagyn-floating-reviews__count">' +
          total +
          " " +
          plural(total, "review", "reviews") +
          "</span>";
      }
      html += "</div>";
    }

    if (visibility.distribution && total > 0) {
      html += '<div class="imagyn-floating-reviews__distribution">';
      html += window.ImagynShared.renderHistogram(summary.ratingCounts, { starLabels: true });
      html += "</div>";
    }

    html += "</div>";

    html += '<div class="imagyn-floating-reviews__body">';
    if (data.reviews.length === 0) {
      html +=
        '<p class="imagyn-floating-reviews__empty">No reviews yet — be the first to share what you think.</p>';
    } else {
      html += '<ul class="imagyn-floating-reviews__list">';
      for (var i = 0; i < data.reviews.length; i++) {
        html += renderReview(data.reviews[i], visibility, !isProductScope);
      }
      html += "</ul>";
    }
    html += "</div>";

    if (settings.ctaLabel) {
      html += '<div class="imagyn-floating-reviews__footer">';
      html +=
        '<button type="button" class="imagyn-floating-reviews__cta" data-imagyn-floating-cta>' +
        escapeHtml(settings.ctaLabel) +
        "</button>";
      html += "</div>";
    }

    return html;
  }

  function renderTabContents(summary, settings, visibility) {
    var html = '<span class="imagyn-floating-reviews__tab-star" aria-hidden="true">★</span>';
    if (visibility.rating) {
      html +=
        '<span class="imagyn-floating-reviews__tab-rating">' + summary.averageRating.toFixed(1) + "</span>";
    }
    html += "<span>" + escapeHtml(settings.label) + "</span>";
    if (visibility.count) {
      html += '<span class="imagyn-floating-reviews__tab-count">(' + summary.totalReviews + ")</span>";
    }
    return html;
  }

  // ---------------------------------------------------------------- Behavior

  var FOCUSABLE =
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function buildWidget(container, data, settings) {
    var visibility = settings.visibility;
    var side = settings.position === "left" ? "left" : "right";

    var tab = document.createElement("button");
    tab.type = "button";
    tab.className =
      "imagyn-floating-reviews__tab imagyn-floating-reviews__tab--" + side;
    tab.setAttribute("aria-expanded", "false");
    tab.setAttribute("aria-haspopup", "dialog");
    tab.innerHTML = renderTabContents(data.summary, settings, visibility);

    var overlay = document.createElement("div");
    overlay.className = "imagyn-floating-reviews__overlay";
    overlay.hidden = true;
    overlay.setAttribute("data-open", "false");

    var panel = document.createElement("div");
    panel.className = "imagyn-floating-reviews__panel imagyn-floating-reviews__panel--" + side;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "imagyn-floating-reviews-title");
    panel.hidden = true;
    panel.setAttribute("data-open", "false");
    panel.innerHTML = renderPanelContents(data, settings, visibility);

    container.appendChild(tab);
    container.appendChild(overlay);
    container.appendChild(panel);

    // Desktop-only vertical placement (the phone breakpoint pins the tab to the bottom edge
    // instead — see the CSS). Clamped so a merchant can never push the tab off-screen.
    var top = Number(settings.verticalPosition);
    if (isFinite(top)) {
      container.style.setProperty("--imagyn-floating-top", Math.min(Math.max(top, 5), 95) + "%");
    }

    var isOpen = false;
    // Restored on close so the merchant's theme keeps whatever overflow it had set itself,
    // rather than being permanently reset to "" by this widget.
    var previousBodyOverflow = "";

    function focusables() {
      return Array.prototype.slice.call(panel.querySelectorAll(FOCUSABLE));
    }

    function open() {
      if (isOpen) {
        return;
      }
      isOpen = true;
      overlay.hidden = false;
      panel.hidden = false;
      // Force a style/layout flush so the browser registers the panel's off-screen start
      // position before the line below flips it — that's what gives the transition something
      // to animate from, instead of the panel simply appearing.
      //
      // Deliberately NOT requestAnimationFrame, which is the obvious way to do this and is
      // wrong here: rAF does not fire at all while the tab is backgrounded, so opening the
      // drawer in a tab that is then hidden (or any context where rAF is throttled) left the
      // panel un-hidden but still translated off-screen AND the page's scroll locked — an
      // invisible drawer the shopper can't see or dismiss. Caught in QA against a real browser
      // with document.visibilityState === "hidden". A forced reflow is synchronous and can't
      // fail that way; the visual result is identical.
      void panel.offsetHeight;
      overlay.setAttribute("data-open", "true");
      panel.setAttribute("data-open", "true");
      tab.setAttribute("aria-expanded", "true");
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      var closeBtn = panel.querySelector("[data-imagyn-floating-close]");
      if (closeBtn) {
        closeBtn.focus();
      }
    }

    function close() {
      if (!isOpen) {
        return;
      }
      isOpen = false;
      overlay.setAttribute("data-open", "false");
      panel.setAttribute("data-open", "false");
      tab.setAttribute("aria-expanded", "false");
      document.body.style.overflow = previousBodyOverflow;
      // Hidden only after the slide-out finishes, so the panel doesn't vanish mid-transition.
      // Uses the same duration the CSS does; a reduced-motion visitor has no transition at
      // all, so the timeout simply resolves against an already-static element.
      window.setTimeout(function () {
        if (!isOpen) {
          overlay.hidden = true;
          panel.hidden = true;
        }
      }, 320);
      tab.focus();
    }

    tab.addEventListener("click", function () {
      if (isOpen) {
        close();
      } else {
        open();
      }
    });

    if (settings.closeOnOverlayClick) {
      overlay.addEventListener("click", close);
    }

    panel.addEventListener("click", function (event) {
      if (event.target.closest("[data-imagyn-floating-close]")) {
        close();
      }
    });

    // Escape closes; Tab is trapped inside the panel while it's open, so keyboard focus can
    // never wander into the storefront behind an open modal dialog.
    document.addEventListener("keydown", function (event) {
      if (!isOpen) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      var items = focusables();
      if (items.length === 0) {
        return;
      }
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    var cta = panel.querySelector("[data-imagyn-floating-cta]");
    if (cta) {
      cta.addEventListener("click", function () {
        // Cross-block coordination over the same two custom events the Rating Badge block
        // already uses (see rating-badge.js) rather than any direct reference between blocks:
        // when the Product Reviews widget is on this page, its real write-a-review form is
        // opened and scrolled to. When it isn't (a collection page, or a product page without
        // that block), there is no form to open, so the shopper is sent to a real destination
        // instead — never a dead button, and never a fabricated form.
        if (document.querySelector("[data-imagyn-write]")) {
          close();
          document.dispatchEvent(new CustomEvent("imagyn:write-review-toggle"));
          return;
        }
        if (settings.ctaUrl) {
          window.location.href = settings.ctaUrl;
        }
      });
    }
  }

  function readSettings(container) {
    return {
      position: container.getAttribute("data-position") || "right",
      verticalPosition: container.getAttribute("data-vertical-position") || "50",
      label: container.getAttribute("data-label") || "Reviews",
      heading: container.getAttribute("data-heading") || "Reviews",
      ctaLabel: container.getAttribute("data-cta-label") || "",
      ctaUrl: container.getAttribute("data-cta-url") || "",
      closeOnOverlayClick: isOn(container.getAttribute("data-close-on-overlay")),
      visibility: {
        rating: isOn(container.getAttribute("data-show-rating")),
        count: isOn(container.getAttribute("data-show-count")),
        distribution: isOn(container.getAttribute("data-show-distribution")),
        verified: isOn(container.getAttribute("data-show-verified")),
        media: isOn(container.getAttribute("data-show-media")),
      },
    };
  }

  function initWidget(container) {
    if (container.getAttribute("data-imagyn-initialized") === "true") {
      return;
    }
    container.setAttribute("data-imagyn-initialized", "true");

    if (!isOn(container.getAttribute("data-enabled"))) {
      return;
    }

    var settings = readSettings(container);
    // Present only on a product page (see floating_reviews.liquid) — the endpoint decides
    // whether to answer with product or store scope from this alone.
    var productId = container.getAttribute("data-product-id") || "";
    var url = PROXY_PATH + (productId ? "?productId=" + encodeURIComponent(productId) : "");

    fetch(url, { headers: { Accept: "application/json" } })
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

        // A store with no approved reviews at all renders nothing — a floating tab promising
        // reviews that opens onto an empty drawer is worse for a shopper than no tab, and the
        // real "write a review" surfaces already live on the product pages themselves.
        if (!data.summary || !data.summary.totalReviews) {
          return;
        }

        if (window.ImagynAppearance) {
          window.ImagynAppearance.apply(data.appearance, container);
        }

        buildWidget(container, data, settings);
      })
      .catch(function () {
        // Fails quietly, same reasoning as store-reviews.js/review-carousel.js's own catch — a
        // broken or unavailable widget disappears rather than showing an error on a page where
        // a shopper has no recovery action anyway.
        container.innerHTML = "";
      });
  }

  function init() {
    var containers = document.querySelectorAll("[data-imagyn-floating-reviews]");
    for (var i = 0; i < containers.length; i++) {
      initWidget(containers[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
