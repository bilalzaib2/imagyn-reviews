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
  // A page must never badge the one product it's already the product page for — that's
  // Rating Badge's spot, not this embed's. Originally excluded via
  // .closest("product-info, [data-product-id]") (Dawn's product-page wrapper tag, plus a
  // "second safeguard" attribute match) — confirmed live on a real merchant (Katran, Ella
  // theme) that the attribute half of that selector is NOT Dawn-specific: Ella's own
  // collection-grid cards carry a routine data-product-id on their own wrapper for
  // unrelated theme JS, so the old guard misfired on every collection-grid card on every
  // page, silently finding zero cards store-wide. Replaced with a comparison against the
  // current page's own URL instead (currentProductHandle below) — this identifies "am I
  // looking at this exact product's own page" directly and correctly on any theme, Dawn or
  // not, rather than guessing at a theme's DOM wrapper conventions.
  var PROXY_PATH = "/apps/reviews/batch";
  var PROCESSED_ATTR = "data-imagyn-card-badge-injected";
  var CARD_SELECTOR = ".card-wrapper";
  var PRODUCT_LINK_SELECTOR = 'a[href*="/products/"]';
  var DEBOUNCE_MS = 300;
  // How far a fallback card container is allowed to walk up from a product link before
  // giving up — bounds the cost of the per-link ancestor walk on very deep/unusual markup.
  var FALLBACK_MAX_DEPTH = 10;

  var scriptEl = document.querySelector("script[data-imagyn-collection-badges]");
  var starColor = scriptEl ? scriptEl.getAttribute("data-star-color") : "";
  var textColor = scriptEl ? scriptEl.getAttribute("data-text-color") : "";

  // Shared with reviews-widget.js / rating-badge.js via imagyn-appearance.js, which every
  // block already loads before its own script.
  var renderStars = window.ImagynShared.renderStars;

  function extractHandleFromHref(href) {
    if (!href) return null;
    var match = href.match(/\/products\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  // Computed once from the URL Shopify itself routed to — platform-level, not theme-level,
  // so it's correct on every theme without any DOM guessing. null on any non-product page,
  // in which case every product link found is by definition someone else's card.
  var currentProductHandle = extractHandleFromHref(window.location.pathname);

  // Finds Dawn product cards and, for each, the title heading + product handle. Never
  // matches the current page's own product (see currentProductHandle above).
  function findCards(root) {
    var found = [];
    var candidates = root.querySelectorAll(CARD_SELECTOR);

    candidates.forEach(function (card) {
      if (card.hasAttribute(PROCESSED_ATTR)) {
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

      if (!heading || !handle || handle === currentProductHandle) {
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

  // Walks up from a product link to the smallest ancestor that still belongs to exactly
  // one product — i.e. every product link inside it resolves to the same handle. Themes
  // commonly render two links per card (an image link and a title link both pointing at
  // the same product); walking up "while every link in here is still the same product"
  // naturally unifies both under one container without needing to know the theme's own
  // class names, and stops before spilling into a container that holds multiple different
  // products (the grid/row wrapper).
  function closestCardContainer(link, handle) {
    var candidate = link;
    var node = link;

    for (var depth = 0; depth < FALLBACK_MAX_DEPTH && node.parentElement; depth++) {
      node = node.parentElement;

      var links = node.querySelectorAll(PRODUCT_LINK_SELECTOR);
      var sameProductOnly = true;
      for (var i = 0; i < links.length; i++) {
        if (extractHandleFromHref(links[i].getAttribute("href")) !== handle) {
          sameProductOnly = false;
          break;
        }
      }

      if (!sameProductOnly) {
        break;
      }

      candidate = node;
    }

    return candidate;
  }

  // Theme-agnostic fallback for stores whose product-card markup isn't Dawn's — e.g.
  // Grace Store, where .card-wrapper/.card__heading don't exist at all, so findCards'
  // Dawn pass above finds nothing. Discovers cards from the one thing every theme's
  // product grid actually has: links to /products/{handle}. Runs after the Dawn pass and
  // only considers links not already inside a card the Dawn pass (or an earlier fallback
  // card, from a second link into the same container) already claimed, so a Dawn store
  // never pays this cost and a store with a mix of Dawn and non-Dawn sections never gets
  // double-processed.
  function findFallbackCards(root) {
    var found = [];
    var links = root.querySelectorAll(PRODUCT_LINK_SELECTOR);

    links.forEach(function (link) {
      if (link.closest("[" + PROCESSED_ATTR + "]")) {
        return;
      }

      var handle = extractHandleFromHref(link.getAttribute("href"));
      if (!handle || handle === currentProductHandle) {
        return;
      }

      var card = closestCardContainer(link, handle);
      if (card.hasAttribute(PROCESSED_ATTR)) {
        return;
      }

      // A real heading element is preferred (matches how the Dawn path anchors to
      // .card__heading); falls back to the link itself when the theme has no heading tag
      // inside the card, so the badge still lands right after the product title/link.
      var heading = card.querySelector("h1, h2, h3, h4, h5, h6") || link;

      card.setAttribute(PROCESSED_ATTR, "true");
      found.push({ card: card, heading: heading, handle: handle });
    });

    return found;
  }

  function injectBadge(entry, summary) {
    // Enforced directly, independent of the PROCESSED_ATTR bookkeeping in findCards: this
    // exact card must never end up with more than one badge, regardless of how it got here.
    if (entry.card.querySelector(".imagyn-card-badge")) {
      return false;
    }

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

        // Appearance System: applied once at :root. .imagyn-card-badge's own CSS
        // already chains through --imagyn-color-star (imagyn-component-badge.css), so
        // every badge injected below inherits it automatically — no per-badge variable
        // needed here. injectBadge's own starColor/textColor (the merchant's Theme
        // Editor setting, read once at script load) still wins locally per badge, since
        // that's an inline style set directly on the element, applied after this.
        if (window.ImagynAppearance) {
          window.ImagynAppearance.apply(data.appearance);
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
    var scopeRoot = root || document;
    // Dawn path first, exactly as before; fallback only ever sees links the Dawn pass
    // didn't already claim (see findFallbackCards), so Dawn stores are unaffected.
    var entries = findCards(scopeRoot).concat(findFallbackCards(scopeRoot));
    processEntries(entries);
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
