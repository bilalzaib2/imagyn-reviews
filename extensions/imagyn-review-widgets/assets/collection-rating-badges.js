(function () {
  // Dawn-only, using Dawn's actual card markup (snippets/card-product.liquid), identical
  // across collection grids, featured collections, related products, and search results:
  //
  //   <div class="card-wrapper product-card-wrapper ...">
  //     ...
  //     <h3 class="card__heading">
  //       <a class="full-unstyled-link" href="/products/{handle}">...</a>
  //     </h3>
  //
  // Dawn's product page wraps the entire main product section in a single custom element,
  // <product-info data-product-id="...">, which has no "card-wrapper" class — excluded
  // explicitly below as well, as a second safeguard against ever matching it.
  var PROXY_PATH = "/apps/reviews/batch";
  var PROCESSED_ATTR = "data-imagyn-card-badge-injected";
  var CARD_SELECTOR = ".card-wrapper";
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

  // Finds Dawn product cards and, for each, the title heading + product handle. Never
  // matches the product page's own <product-info> wrapper, which is not a .card-wrapper.
  function findCards(root) {
    var found = [];
    var candidates = root.querySelectorAll(CARD_SELECTOR);

    candidates.forEach(function (card) {
      if (card.hasAttribute(PROCESSED_ATTR)) {
        return;
      }

      if (card.closest("product-info, [data-product-id]")) {
        return;
      }

      // Dawn renders .card__heading twice per card (a hidden alternate-layout copy plus the
      // visible one); picking the one with a non-null offsetParent selects the rendered one.
      var headingCandidates = card.querySelectorAll(".card__heading");
      var heading = null;
      for (var h = 0; h < headingCandidates.length; h++) {
        if (headingCandidates[h].offsetParent !== null) {
          heading = headingCandidates[h];
          break;
        }
      }
      if (!heading && headingCandidates.length > 0) {
        heading = headingCandidates[0];
      }

      var link = heading ? heading.querySelector("a[href]") : card.querySelector('a.full-unstyled-link[href*="/products/"]');
      var handle = extractHandleFromHref(link ? link.getAttribute("href") : null);

      if (!heading || !handle) {
        return;
      }

      // Claimed synchronously, at discovery time — not after the batch request resolves.
      // The batch fetch is async; without claiming here, a debounced re-scan triggered while
      // the first request is still in flight (common on sections with slider/lazy-load JS,
      // like Featured Collection) would find the same unclaimed card again and start a
      // second request, producing two badges. This makes a card+badge pairing idempotent
      // regardless of how long the network round trip takes — no timers involved.
      card.setAttribute(PROCESSED_ATTR, "true");
      found.push({ card: card, heading: heading, handle: handle });
    });

    return found;
  }

  function injectBadge(entry, summary) {
    if (!summary || summary.totalReviews === 0) {
      return false;
    }

    var badge = document.createElement("span");
    badge.className = "imagyn-card-badge";
    if (starColor) badge.style.setProperty("--imagyn-card-badge-star-color", starColor);
    if (textColor) badge.style.setProperty("--imagyn-card-badge-text-color", textColor);
    badge.innerHTML =
      '<span class="imagyn-card-badge__stars" aria-hidden="true">' + renderStars(summary.averageRating) + "</span>" +
      '<span class="imagyn-card-badge__count">(' + summary.totalReviews + ")</span>";

    // Beneath the title, always: inserted as the next sibling of the visible <h3
    // class="card__heading"> (see findCards — Dawn renders this heading twice per card).
    entry.heading.parentElement.insertBefore(badge, entry.heading.nextSibling);

    return true;
  }

  // One batched request for every card found in this pass, instead of one request per card.
  function processEntries(entries) {
    if (entries.length === 0) {
      return;
    }

    var handles = entries.map(function (entry) {
      return entry.handle;
    });

    var endpoint = PROXY_PATH + "?handles=" + encodeURIComponent(handles.join(","));

    fetch(endpoint, { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Request failed with status " + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          throw new Error("Unable to load ratings");
        }

        entries.forEach(function (entry) {
          injectBadge(entry, data.byHandle[entry.handle]);
        });
      })
      .catch(function () {
        // Cards are already claimed (see findCards) regardless of outcome, so there's
        // nothing further to mark here — just avoid an unhandled promise rejection.
      });
  }

  function scan(root) {
    processEntries(findCards(root || document));
  }

  scan();

  // One debounced MutationObserver covers AJAX-loaded collections ("load more"), predictive
  // search results, and any other dynamically injected cards, without theme-specific AJAX
  // hooks. Already-processed cards are skipped, so re-scans after a badge injection are cheap.
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
