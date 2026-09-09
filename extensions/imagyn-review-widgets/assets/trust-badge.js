(function () {
  // Same App Proxy convention as every other widget script — see shopify.app.toml's
  // [app_proxy] config (prefix "apps", subpath "reviews") and app/routes/api.reviews.trust.tsx.
  var PROXY_PATH = "/apps/reviews/trust";

  var renderStars = window.ImagynShared.renderStars;
  var escapeHtml = window.ImagynShared.escapeHtml;
  var renderHistogram = window.ImagynShared.renderHistogram;
  var animateHistogramFills = window.ImagynShared.animateHistogramFills;

  var CERTIFIED_ICON =
    '<svg class="imagyn-trust-badge__certified-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">' +
    '<path d="M10 1.5l2.34 1.4 2.72-.24 1.02 2.53 2.42 1.28-.68 2.66.68 2.66-2.42 1.28-1.02 2.53-2.72-.24L10 18.5l-2.34-1.4-2.72.24-1.02-2.53-2.42-1.28.68-2.66-.68-2.66 2.42-1.28 1.02-2.53 2.72.24z"/>' +
    '<path d="M7.2 10.2l1.8 1.8 3.8-3.8" stroke="var(--imagyn-color-surface,#fff)" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";

  var PILLAR_STATUS_LABEL = {
    met: "Met",
    not_met: "Not met",
    pending: "Calculating",
    needs_permission: "Pending",
  };

  // One shared modal instance for the page — same "lazily created, reused" convention as
  // reviews-widget.js's createLightbox. Accessible dialog: focus trapped while open, Escape
  // closes, focus restored to whatever badge opened it.
  var modalState = null;

  function createModal() {
    var overlay = document.createElement("div");
    overlay.className = "imagyn-modal-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="imagyn-modal" role="dialog" aria-modal="true" aria-label="Trust Certification details">' +
      '<button type="button" class="imagyn-modal__close" aria-label="Close">&times;</button>' +
      '<div data-imagyn-trust-modal-body></div>' +
      "</div>";
    document.body.appendChild(overlay);

    var closeBtn = overlay.querySelector(".imagyn-modal__close");
    var body = overlay.querySelector("[data-imagyn-trust-modal-body]");
    var lastFocusedElement = null;

    function getFocusable() {
      return Array.prototype.slice.call(
        overlay.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'),
      );
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
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

    function open(html, triggerEl) {
      body.innerHTML = html;
      lastFocusedElement = triggerEl || document.activeElement;
      overlay.hidden = false;
      document.addEventListener("keydown", onKeyDown);
      closeBtn.focus();
      var fills = body.querySelectorAll("[data-target-fill]");
      if (fills.length > 0) animateHistogramFills(body);
    }

    function close() {
      overlay.hidden = true;
      document.removeEventListener("keydown", onKeyDown);
      body.innerHTML = "";
      if (lastFocusedElement && lastFocusedElement.focus) {
        lastFocusedElement.focus();
      }
    }

    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });

    return { open: open, close: close };
  }

  function getModal() {
    if (!modalState) modalState = createModal();
    return modalState;
  }

  function renderPillarRow(pillar) {
    var metClass = pillar.status === "met" ? " imagyn-trust-modal__pillar-status--met" : "";
    return (
      '<li class="imagyn-trust-modal__pillar">' +
      "<span>" + escapeHtml(pillar.title) + "</span>" +
      '<span class="imagyn-trust-modal__pillar-status' + metClass + '">' +
      escapeHtml(PILLAR_STATUS_LABEL[pillar.status] || pillar.statusLabel) +
      "</span>" +
      "</li>"
    );
  }

  function renderModalBody(data) {
    var trust = data.trust;
    var storeName = (data.store && data.store.name) || "This store";
    var isCertified = trust.status === "certified";

    var html = '<div class="imagyn-trust-modal__header">';
    html += '<p class="imagyn-trust-modal__store">' + escapeHtml(storeName) + "</p>";
    if (isCertified) {
      html +=
        '<span class="imagyn-trust-badge__certified">' + CERTIFIED_ICON + "<span>Certified</span></span>";
    }
    html += "</div>";

    html += '<div class="imagyn-trust-modal__stats">';
    html +=
      '<div><p class="imagyn-trust-modal__stat-value">' +
      trust.verifiedAverageRating.toFixed(1) +
      '</p><p class="imagyn-trust-modal__stat-label">Verified average rating</p></div>';
    html +=
      '<div><p class="imagyn-trust-modal__stat-value">' +
      trust.verifiedReviewCount +
      '</p><p class="imagyn-trust-modal__stat-label">Verified reviews</p></div>';
    html += "</div>";

    html += '<p class="imagyn-trust-modal__section-title">Rating distribution</p>';
    html += renderHistogram(data.ratingDistribution || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });

    html += '<p class="imagyn-trust-modal__section-title">IMAGYN Trust Certification</p>';
    html += '<ul class="imagyn-trust-modal__pillars">' + trust.pillars.map(renderPillarRow).join("") + "</ul>";

    if (data.aiSpotlight) {
      html += '<p class="imagyn-trust-modal__section-title">What customers are saying</p>';
      html += '<p class="imagyn-trust-modal__summary-text">' + escapeHtml(data.aiSpotlight.recommendation) + "</p>";

      var positives = data.aiSpotlight.positives || [];
      var negatives = data.aiSpotlight.negatives || [];
      if (positives.length > 0 || negatives.length > 0) {
        html += '<div class="imagyn-trust-modal__sentiment">';
        if (positives.length > 0) {
          html +=
            "<div><p class=\"imagyn-trust-modal__stat-label\">Loved</p><ul class=\"imagyn-trust-modal__sentiment-list\">" +
            positives.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("") +
            "</ul></div>";
        }
        if (negatives.length > 0) {
          html +=
            "<div><p class=\"imagyn-trust-modal__stat-label\">Watch out for</p><ul class=\"imagyn-trust-modal__sentiment-list\">" +
            negatives.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("") +
            "</ul></div>";
        }
        html += "</div>";
      }
    }

    if (data.media && data.media.length > 0) {
      html += '<p class="imagyn-trust-modal__section-title">Verified customer media</p>';
      html += '<div class="imagyn-trust-modal__media">';
      html += data.media
        .map(function (item) {
          var thumb = item.thumbnailUrl || item.url;
          if (item.type === "VIDEO") {
            return '<div class="imagyn-trust-modal__media-item"><video src="' + item.url + '" muted playsinline></video></div>';
          }
          return '<div class="imagyn-trust-modal__media-item"><img src="' + thumb + '" alt="Verified customer photo" loading="lazy"></div>';
        })
        .join("");
      html += "</div>";
    }

    html +=
      '<p class="imagyn-trust-modal__explainer">"Verified" means a review came from a real purchase on this ' +
      "store, confirmed by Shopify order data. Only verified, published reviews count toward the rating and " +
      "count shown here — this store cannot manually mark a review verified.</p>";

    return html;
  }

  function renderBadge(root, data, showCertification) {
    var trust = data.trust;

    if (!trust || trust.paused || trust.verifiedReviewCount === 0) {
      root.setAttribute("hidden", "");
      return;
    }

    root.removeAttribute("hidden");

    var isCertified = trust.status === "certified";
    var html =
      '<button type="button" class="imagyn-trust-badge" data-imagyn-trust-badge-trigger aria-haspopup="dialog">' +
      '<span class="imagyn-trust-badge__stars" aria-hidden="true">' + renderStars(trust.verifiedAverageRating) + "</span>" +
      '<span class="imagyn-trust-badge__rating">' + trust.verifiedAverageRating.toFixed(1) + "</span>" +
      '<span class="imagyn-trust-badge__count">(' +
      trust.verifiedReviewCount +
      (trust.verifiedReviewCount === 1 ? " verified review" : " verified reviews") +
      ")</span>";

    if (isCertified && showCertification) {
      html += '<span class="imagyn-trust-badge__certified">' + CERTIFIED_ICON + "<span>Certified</span></span>";
    }

    html += "</button>";
    root.innerHTML = html;

    var trigger = root.querySelector("[data-imagyn-trust-badge-trigger]");
    trigger.addEventListener("click", function () {
      getModal().open(renderModalBody(data), trigger);
    });
  }

  function init(scope) {
    (scope || document)
      .querySelectorAll("[data-imagyn-trust-badge]:not([data-imagyn-trust-badge-initialized])")
      .forEach(function (root) {
        root.setAttribute("data-imagyn-trust-badge-initialized", "true");

        var starColor = root.getAttribute("data-star-color");
        if (starColor) root.style.setProperty("--imagyn-trust-badge-star-color", starColor);
        var showCertification = root.getAttribute("data-show-certification") !== "false";

        fetch(PROXY_PATH, { headers: { Accept: "application/json" } })
          .then(function (response) {
            if (!response.ok) throw new Error("Request failed");
            return response.json();
          })
          .then(function (data) {
            if (!data || !data.ok) throw new Error((data && data.error) || "Unable to load Trust Certification");

            if (window.ImagynAppearance && data.appearance) {
              window.ImagynAppearance.apply(data.appearance);
            }

            renderBadge(root, data, showCertification);
          })
          .catch(function () {
            root.setAttribute("hidden", "");
          });
      });
  }

  init();

  document.addEventListener("shopify:section:load", function (event) {
    init(event.target);
  });
})();
