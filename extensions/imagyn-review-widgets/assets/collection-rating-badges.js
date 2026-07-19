(function () {
  // Fully independent of reviews-widget.js and rating-badge.js by design — this embed
  // covers a different surface (collection grids, search results, featured/related product
  // sections) and reuses only the backend batch endpoint, not any client code from those
  // other two blocks.
  var PROXY_PATH = "/apps/reviews/batch";
  var PROCESSED_ATTR = "data-imagyn-card-badge-injected";
  // Dawn/OS 2.0 conventions first; a universal product-link fallback covers themes that
  // don't use these class names.
  var CARD_SELECTORS = ["[data-product-id]", ".card-wrapper", ".product-card", ".card--product", "[data-product-card]"];
  var DEBOUNCE_MS = 300;

  var scriptEl = document.querySelector("script[data-imagyn-collection-badges]");
  var starColor = scriptEl ? scriptEl.getAttribute("data-star-color") : "";
  var textColor = scriptEl ? scriptEl.getAttribute("data-text-color") : "";

  function renderStars(rating) {
    var full = Math.round(rating);
    var stars = "";
    for (var i = 0; i < 5; i++) {
      stars += i < full ? "★" : "☆";
    }
    return stars;
  }

  function extractHandleFromHref(href) {
    if (!href) return null;
    var match = href.match(/\/products\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  // Finds card-like containers and, for each, a product identifier (id or handle) plus the
  // link to attach the badge near. Dedupes both by DOM node and by resolved product
  // identity, since the class-based pass and the link-fallback pass can land on different
  // container elements for the same card.
  function findCards(root) {
    var found = [];
    var seenContainers = [];
    var seenKeys = {};

    function considerContainer(container, link) {
      if (!container || container.hasAttribute(PROCESSED_ATTR)) {
        return;
      }
      if (seenContainers.indexOf(container) !== -1) {
        return;
      }

      var productId = container.getAttribute("data-product-id") || (link && link.getAttribute("data-product-id"));
      var handle = extractHandleFromHref(link ? link.getAttribute("href") : null);
      var key = productId ? "id:" + productId : handle ? "handle:" + handle : null;

      if (!key || seenKeys[key]) {
        return;
      }

      seenContainers.push(container);
      seenKeys[key] = true;
      found.push({ container: container, link: link, productId: productId, handle: handle });
    }

    CARD_SELECTORS.forEach(function (selector) {
      root.querySelectorAll(selector).forEach(function (el) {
        var link = el.matches('a[href*="/products/"]') ? el : el.querySelector('a[href*="/products/"]');
        considerContainer(el, link);
      });
    });

    // Fallback for themes with no recognizable card-wrapper class: climb a few ancestor
    // levels from the product link to find a reasonably card-sized container.
    root.querySelectorAll('a[href*="/products/"]').forEach(function (link) {
      var container = link.closest("li, .grid__item") || link.parentElement;
      var depth = 0;
      while (container && container.parentElement && container.children.length === 1 && depth < 3) {
        container = container.parentElement;
        depth += 1;
      }
      considerContainer(container, link);
    });

    return found;
  }

  function injectBadge(entry, summary) {
    entry.container.setAttribute(PROCESSED_ATTR, "true");

    if (!summary || summary.totalReviews === 0) {
      return;
    }

    var badge = document.createElement("span");
    badge.className = "imagyn-card-badge";
    if (starColor) badge.style.setProperty("--imagyn-card-badge-star-color", starColor);
    if (textColor) badge.style.setProperty("--imagyn-card-badge-text-color", textColor);
    badge.innerHTML =
      '<span class="imagyn-card-badge__stars" aria-hidden="true">' + renderStars(summary.averageRating) + "</span>" +
      '<span class="imagyn-card-badge__count">(' + summary.totalReviews + ")</span>";

    var anchor = entry.link || entry.container;
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(badge, anchor.nextSibling);
    } else {
      entry.container.appendChild(badge);
    }
  }

  // One batched request for every card found in this pass, instead of one request per card.
  function processEntries(entries) {
    if (entries.length === 0) {
      return;
    }

    var productIds = [];
    var handles = [];

    entries.forEach(function (entry) {
      if (entry.productId) {
        productIds.push(entry.productId);
      } else if (entry.handle) {
        handles.push(entry.handle);
      }
    });

    var params = [];
    if (productIds.length > 0) params.push("productIds=" + encodeURIComponent(productIds.join(",")));
    if (handles.length > 0) params.push("handles=" + encodeURIComponent(handles.join(",")));

    if (params.length === 0) {
      entries.forEach(function (entry) {
        entry.container.setAttribute(PROCESSED_ATTR, "true");
      });
      return;
    }

    fetch(PROXY_PATH + "?" + params.join("&"), { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Request failed");
        }
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          throw new Error("Unable to load ratings");
        }
        entries.forEach(function (entry) {
          var summary = (entry.productId && data.byProductId[entry.productId]) || (entry.handle && data.byHandle[entry.handle]);
          injectBadge(entry, summary);
        });
      })
      .catch(function () {
        entries.forEach(function (entry) {
          entry.container.setAttribute(PROCESSED_ATTR, "true");
        });
      });
  }

  function scan(root) {
    processEntries(findCards(root || document));
  }

  scan();

  // One debounced MutationObserver covers AJAX-loaded collections ("load more"), predictive
  // search results, and any other dynamically injected cards, without theme-specific AJAX
  // hooks. Debounced so a burst of DOM changes triggers one re-scan, not one per mutation;
  // already-processed containers are skipped, so re-scans after a badge injection are cheap.
  var debounceTimer = null;
  var observer = new MutationObserver(function () {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(function () {
      scan();
    }, DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Theme Editor section re-renders (settings changes) swap in new HTML via AJAX too.
  document.addEventListener("shopify:section:load", function (event) {
    scan(event.target);
  });
})();
