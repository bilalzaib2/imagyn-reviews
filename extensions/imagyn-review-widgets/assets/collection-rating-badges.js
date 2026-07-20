(function () {
  // Dawn-only, using Dawn's actual verified card markup (snippets/card-product.liquid,
  // confirmed identical across collection grids, featured collections, related products,
  // and the search results page):
  //
  //   <div class="card-wrapper product-card-wrapper ...">
  //     ...
  //     <h3 class="card__heading">
  //       <a class="full-unstyled-link" href="/products/{handle}">...</a>
  //     </h3>
  //
  // Dawn's product page wraps the ENTIRE main product section in a single custom element,
  // <product-info data-product-id="...">, which has no "card-wrapper" class — excluded
  // explicitly below as well, as a second safeguard against ever matching it.
  var PROXY_PATH = "/apps/reviews/batch";
  var PROCESSED_ATTR = "data-imagyn-card-badge-injected";
  var CARD_SELECTOR = ".card-wrapper";
  var DEBOUNCE_MS = 300;

  // Set to false to silence the temporary debug logging once this is verified working.
  var DEBUG = true;

  function log() {
    if (DEBUG && window.console && console.log) {
      var args = ["[imagyn:collection-badges]"].concat(Array.prototype.slice.call(arguments));
      console.log.apply(console, args);
    }
  }

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

    log("card containers matched (" + CARD_SELECTOR + "):", candidates.length);

    candidates.forEach(function (card) {
      if (card.hasAttribute(PROCESSED_ATTR)) {
        return;
      }

      if (card.closest("product-info, [data-product-id]")) {
        // Defensive: never treat anything inside the main product page wrapper as a card.
        return;
      }

      // Dawn renders .card__heading TWICE per card (a hidden alternate-layout copy plus the
      // real, visible one) — querySelector() alone returns whichever comes first in DOM
      // order, which is the hidden one on this theme, so the badge was landing in a
      // display:none subtree (confirmed live: rect 0x0, computed display:none on its
      // .card__information ancestor). Picking the one with a non-null offsetParent selects
      // the actually-rendered heading instead.
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

      found.push({ card: card, heading: heading, handle: handle });
    });

    log(
      "product handles extracted:",
      found.map(function (entry) {
        return entry.handle;
      }),
    );

    return found;
  }

  function injectBadge(entry, summary) {
    entry.card.setAttribute(PROCESSED_ATTR, "true");

    log("[" + entry.handle + "] rating object:", summary);

    if (!summary || summary.totalReviews === 0) {
      return false;
    }

    var generatedHtml =
      '<span class="imagyn-card-badge__stars" aria-hidden="true">' + renderStars(summary.averageRating) + "</span>" +
      '<span class="imagyn-card-badge__count">(' + summary.totalReviews + ")</span>";
    log("[" + entry.handle + "] generated HTML:", generatedHtml);

    var badge = document.createElement("span");
    badge.className = "imagyn-card-badge";
    if (starColor) badge.style.setProperty("--imagyn-card-badge-star-color", starColor);
    if (textColor) badge.style.setProperty("--imagyn-card-badge-text-color", textColor);
    badge.innerHTML = generatedHtml;
    log("[" + entry.handle + "] badge.innerHTML before insertion:", badge.innerHTML);

    // Beneath the title, always: inserted as the next sibling of the visible <h3
    // class="card__heading"> (see findCards — Dawn renders this heading twice per card).
    entry.heading.parentElement.insertBefore(badge, entry.heading.nextSibling);
    log("[" + entry.handle + "] badge.outerHTML after insertion:", badge.outerHTML);
    log(
      "[" + entry.handle + "] badge rect after insertion:",
      (function () {
        var r = badge.getBoundingClientRect();
        return { width: r.width, height: r.height };
      })(),
    );

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
    log("batch request:", endpoint);

    fetch(endpoint, { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Request failed with status " + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        log("batch response:", data);

        if (!data || !data.ok) {
          throw new Error("Unable to load ratings");
        }

        var insertedCount = 0;
        entries.forEach(function (entry) {
          var summary = data.byHandle[entry.handle];
          if (injectBadge(entry, summary)) {
            insertedCount += 1;
          }
        });
        log("badges inserted:", insertedCount, "of", entries.length, "cards");
      })
      .catch(function (error) {
        log("batch request failed:", error);
        entries.forEach(function (entry) {
          entry.card.setAttribute(PROCESSED_ATTR, "true");
        });
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
