# TROUBLESHOOTING.md

Incident reports and diagnostic reference for Imagyn Reviews. Add a new dated incident section for anything that took more than a few minutes to diagnose — the point is to never re-derive the same investigation twice.

---

## Quick reference: symptom → likely cause

| Symptom | Check first | Details |
|---|---|---|
| Embedded app shows a broken/crashed iframe icon, sidebar submenu (Dashboard/Reviews/etc.) missing | Iframe `src` origin — is it Railway, or a `trycloudflare.com` tunnel? | See [Incident 2026-07-21](#incident-2026-07-21-embedded-app-broken-after-development-work) below. Almost always a leftover `shopify app dev` session, not a code bug. |
| Embedded app renders styled, then becomes completely unstyled HTML a moment later (serif headings, blue underlined links, no layout) | A React hydration failure, not a stylesheet problem — the console reports `Expected server HTML to contain a matching <X> in <Y>` | See [Incident 2026-11-11](#incident-2026-11-11-embedded-dashboard-loses-all-css-mid-load) below, **including the correction at the top of it**. A failed hydration discards the dev-only critical-CSS node. Development-only; production ships real stylesheet links. |
| `/app` returns `410` when hit directly, unauthenticated | Expected behavior — this is Shopify's own "exit iframe" bounce (`boundary.error()`), not an error | Not a bug. Only investigate further if the *embedded* (authenticated, real iframe) path also fails. |
| React error `#418` / `#423` in console when testing a route locally | Check whether you hit the route with real `shop`/embedded session params | These are hydration-mismatch codes; the underlying cause is almost always something upstream (see incident below) throwing before React finishes hydrating — the codes themselves are rarely the root cause. Decode at `react.dev/errors/<code>` for the specific meaning. |
| `prisma migrate deploy` fails with `P3005: database schema is not empty` | Is `_prisma_migrations` missing entirely? | See [OPERATIONS.md](./OPERATIONS.md#recovering-a-missing-_prisma_migrations-table) — this is a migration-history reconciliation, not a schema problem. |
| Railway logs show no request matching a browser action you just took | Confirm what origin the browser is actually loading, not what you assume it's loading | Don't assume the embedded iframe is hitting Railway — verify the `src` directly (see below). |

---

## Incident 2026-07-21: Embedded app broken after development work

### Incident

The embedded Shopify app stopped loading inside Shopify Admin after a day of development work (Appearance System, JSON-LD structured data, Email Review Requests platform, a performance change, and six related commits). The admin iframe showed a broken/crashed document icon; the app's own sidebar submenu (Dashboard, Reviews, Products, Requests, Widgets, Appearance, Settings) did not appear at all.

### Initial symptoms

- Embedded app opened a broken iframe in Shopify Admin.
- Railway deployment: healthy (`● Online`, clean startup logs, no exceptions).
- Database: healthy (Postgres `● Online`, all expected tables present, application row counts unchanged and correct).
- Prisma migrations: healthy (`prisma migrate deploy` reported "No pending migrations to apply").
- `application_url` in `shopify.app.toml`: correct, always pointed at `https://imagyn-reviews-production.up.railway.app`.
- Deployments succeeded (Railway auto-deployed cleanly from every `git push`, confirmed via new deployment IDs each time).
- React application code was incorrectly suspected for a significant portion of the investigation (see timeline).
- Eight commits from the day's work were individually investigated as possible causes.

### Investigation timeline (in order, with why each hypothesis was rejected)

1. **Root-cause report checklist (Railway/logs/migrations/env/local start).** All server-side signals were clean: healthy deployment, no runtime exceptions in Railway logs, `prisma migrate deploy` reporting nothing pending, local `npm run build` + local server start both succeeded with no errors. → **Rejected: nothing wrong with the server, the database, or the deployed build.**

2. **`shouldRevalidate` on the root loader (`app/routes/app.tsx`).** A same-day performance change added `export function shouldRevalidate() { return false }`. Suspected as the cause of a client-side hydration mismatch. **Reverted, rebuilt, redeployed to production, and verified live** — the app was still broken afterward. → **Rejected by a real production test, not by inspection.** (The revert itself was later re-applied in spirit — see Root Cause — since it was a legitimate, unrelated performance improvement worth keeping regardless.)

3. **Git history / commit-by-commit audit.** Every commit between the last known-good commit (`c9bf6f2`) and the current one was inspected for changes to `app/routes/app.tsx`, `app/root.tsx`, `app/entry.server.tsx`, `app/shopify.server.ts`, `vite.config.ts`, `react-router.config.ts` (doesn't exist in this repo), and `package.json`. Only `app/routes/app.tsx` (nav-item line + the already-cleared `shouldRevalidate`) and `package.json` (one new npm script, no dependency changes) were touched among these files. The net diff of `app.tsx` between known-good and current state was a single static nav-item object. → **Rejected: git history could rule candidates out, but a diff alone cannot prove or disprove a runtime failure without an actual test.**

4. **Local git bisect via `npm run build` + `react-router-serve`, testing commits by checking them out into git worktrees.** Multiple commits (`00b60f0`, `291225f`, and several hand-isolated variants with individual files reverted) all appeared to fail the same way. **This test method was later proven invalid**: the known-good baseline commit (`c9bf6f2`), tested the identical way, *also* "failed" — meaning the test itself was broken, not the code. → **Rejected: false positive across the board.** Root cause of the false positive: hitting a bare `/app` URL locally with no `shop` query parameter causes Shopify's own `app-bridge.js` to throw `"App Bridge Next: missing required configuration fields: shop"` — an unrelated, pre-existing condition that fires on any commit tested this way, not a regression.

5. **Non-minified, source-mapped production build.** Rebuilt with `--minify false --sourcemapClient true --sourcemapServer true` to get real component names instead of minified React error codes (`#418`/`#423`). This is what surfaced the App Bridge `missing required configuration fields: shop` exception above, which in turn explained why every earlier bare-URL test looked broken. → **Not rejected — this step is what un-blocked the investigation**, by revealing the "hydration mismatch" errors were downstream noise from a local-testing artifact, not a real defect.

6. **Cross-origin iframe console access.** Attempted to read the *real* embedded iframe's console (not a local test) via direct JS, via reading the iframe's `src` attribute for replay, and via the accessibility tree. All blocked by browser same-origin policy or by a deliberate tool safety guard (refusing to expose the iframe's `src`, since it carried live session tokens). → **Correctly blocked, not a bug in the tooling** — do not attempt to bypass this; it protects live credentials.

7. **Iframe `src` inspection from the top frame.** Reading `document.querySelectorAll('iframe')[0].src` (parent-set attribute, readable despite cross-origin content) revealed the actual value: `https://<random-words>.trycloudflare.com` — **not** `imagyn-reviews-production.up.railway.app`. Confirmed dead via `curl` (`Could not resolve host`). → **This was the actual breakthrough.** Everything downstream confirmed and fixed this one fact.

8. **Shopify Dev Dashboard inspection (`dev.shopify.com/dashboard/.../apps/<id>`).** Checked the app's `Settings` page in full — no field for App URL / redirect URLs exists there at all for this app's config model. Checked `Versions` — found the actually-active version (`imagyn-reviews-47`, an auto-created dev-session version from earlier the same day) and its full config record, confirming `app_url` was correct there too. Checked `Installs` — a single install on `verveonline`, dated **July 19**, with no exposed URL detail. → **Confirmed the registered app configuration was correct; the problem was not there.**

9. **Admin GraphQL API introspection.** Full introspection of the `AppInstallation` and `App` types confirmed neither exposes the actual backend/embed URL — only `launchUrl` (Shopify's own internal "open this app" navigation link, not the backend target) and App Store listing URLs. → **Confirmed there is no queryable field for this anywhere in the public Admin API** — the override lives entirely in Shopify's internal dev-tooling state.

10. **`shopify app deploy --no-release` + inspection + `shopify app release`.** Created a new app version, inspected its full config record directly in the Dev Dashboard *before* releasing it (confirmed `app_url` correct, confirmed the same single theme extension with the same UID, no surprises), released it, then re-verified the live embedded app. **The dead tunnel was still there afterward**, even from a brand-new browser tab. → **Rejected as a complete fix on its own**: releasing a new "active version" does not retroactively update an already-established dev-session override on an existing installation.

11. **`shopify app dev` start → verify → clean shutdown (`SIGINT`) hypothesis.** Started a fresh `shopify app dev` session (new tunnel, confirmed registered and rendering correctly), then sent `SIGINT` for a graceful shutdown. **The override was not released** — the now-dead tunnel remained registered, same failure mode with a different dead URL. → **Rejected: a clean process shutdown does not, by itself, release the override.**

12. **Installation-level caching investigation (read-only): Admin API, Dev Dashboard, and Shopify documentation research.** Confirmed (again) that no API or dashboard surface exposes this state directly. Found a Shopify Developer Community thread reporting the exact same symptom, where the reporter found reinstalling "worked" but explicitly noted this was *not* documented/expected behavior. A response in the same thread (from an apparent Shopify staff member) pointed at the actual fix: *"The dev version of your app will remain on that store until you run `shopify app dev clean`."* → **This narrowed the fix to a specific, documented command rather than the much more disruptive reinstall.**

### Root cause

**A stale Shopify Dev Preview**, created earlier the same day by running `shopify app dev` for theme-extension testing.

Running `shopify app dev` temporarily overrides the embedded app URL Shopify Admin uses for a specific development store, pointing it at that session's local tunnel instead of the app's real registered `application_url`. This override is tracked **per development store**, separately from which app version is "active."

**Stopping the dev server — even via a clean shutdown signal — did not automatically restore the store to the active production version.** The store kept pointing at the (now-dead) Cloudflare tunnel from the finished dev session indefinitely, until explicitly cleared.

This was confirmed **not** caused by, in this order of investigation:
- Railway (deployment, logs, and database all healthy throughout)
- Prisma / migrations (all healthy, correctly reconciled, nothing pending)
- React application code (no component ever actually failed to render correctly once given a real URL to load from)
- App Bridge itself (behaved exactly as designed — the "missing shop" error was a local-testing artifact, not a bug)
- `shouldRevalidate` (reverted and redeployed for real; app remained broken)
- `application_url` in `shopify.app.toml` (was correct the entire time, in every version inspected)
- Any deployment step (every deploy succeeded cleanly; the problem was never "did the deploy work")
- Production application code in general (zero application code changes were part of the actual fix)

### Official fix

```bash
shopify app dev clean --store=verveonline.myshopify.com
```

Per the Shopify CLI's own description: *"Stop the dev preview that was started with `shopify app dev`. It restores the app's active version to the selected development store."*

This is the single command that resolves this exact failure mode. It requires no code change, no redeploy, no reinstall, and affects no merchant/application data — it only clears a per-store dev-preview pointer.

**Verification after running it:** open the embedded app in a completely fresh browser tab and inspect the iframe's `src` origin directly:

```js
document.querySelector('iframe[name="app-iframe"]').src
```

It should be `https://imagyn-reviews-production.up.railway.app/...` — not a `trycloudflare.com` URL.

### Prevention

See [SHOPIFY_DEV_WORKFLOW.md](./SHOPIFY_DEV_WORKFLOW.md) for the standing rule this incident produced: **always run `shopify app dev clean` before ending any `shopify app dev` session**, not just when it's inconvenient to leave running.

---

## Incident 2026-11-11: Embedded dashboard loses all CSS mid-load

### Symptom

In the embedded app on `verveonline`, the dashboard renders correctly styled, then a moment
later becomes completely unstyled HTML — serif headings, blue underlined links, no layout —
and stays that way until a manual refresh. Loader data and hydration are unaffected: the
content is all there and correct, only the styling is gone. This makes it read as a CSS,
Polaris or stylesheet-loading problem. It is none of those.

### CORRECTION (2026-11-11, later the same day)

**The root cause recorded below is incomplete, and on its own it is wrong.** Removing the
re-optimization trigger did not fix the bug — the dashboard went on rendering unstyled with
zero re-optimization events in the log. Read this correction first; the original analysis is
kept underneath because the mechanism it describes is real and its measurements still hold.

**The actual root cause is a failed React hydration.** Instrumented from inside the embedded
iframe (cross-origin, so its DOM and console cannot be read from the admin page — the page was
made to POST its own stylesheet census back to the dev server), a failing load reports:

```
Uncaught Error: Hydration failed because the initial UI does not match what was rendered on the server.
Warning: Expected server HTML to contain a matching <div> in <p>.
  at div / at StarRating / at p / at Metric / at Index          (/app)
Warning: Expected server HTML to contain a matching <ui-save-bar> in <div>.
  at ui-save-bar / at InternalSaveBar / at ContextualSaveBar    (/app/email-studio, /app/appearance)
```

When hydration fails React discards the server-rendered DOM and re-renders from scratch. In
development that takes React Router's single `data-react-router-critical-css` node with it and
nothing replaces it — measured at **0 CSS rules**, `body` background `rgba(0, 0, 0, 0)`. That
is the unstyled dashboard, and it persists until a manual refresh.

Two distinct mismatches, both fixed:

1. **`Metric` wrapped its `ReactNode` slots in `<p>`.** The dashboard passes `<StarRating/>`
   (root: a `<div>`) as `sub`. A `<div>` inside a `<p>` is invalid HTML; the parser auto-closes
   the paragraph, so the parsed DOM can never match the tree the server rendered.
2. **`ContextualSaveBar` seeded its readiness state from `window.shopify`.** The server has no
   `window` and renders null, so whenever App Bridge's script had already run the first client
   render emitted `<ui-save-bar>` where the server payload had nothing.

**Why the first diagnosis looked right.** A dependency re-optimization does trigger a reload,
and every reload is another chance to lose the hydration race — so removing it genuinely cut
the failure rate, enough to look like a fix across a handful of loads. It was not one. The
lesson: verify an intermittent fix with a measurement across many loads, not a few screenshots.

**Production was never affected.** The critical-CSS mechanism is development-only; a real
production build was checked and ships ordinary stylesheet links — 42 CSS assets emitted, zero
`data-react-router-critical-css` occurrences in the served HTML. A dev-loop defect, not a
release blocker.

**Verification after both fixes**, against the real embedded app on verveonline: `/app` across
10 cold loads and 10 hard refreshes — **15 final-state samples, 0 unstyled**; `/app/reviews`,
`/app/settings`, `/app/settings/requests`, `/app/email-studio`, `/app/appearance` all styled;
**0 hydration failures, 0 "Expected server HTML" mismatches**.

---

### Original root cause (partial — see the correction above)

A **Vite dependency re-optimization firing while the dashboard's route tree was loading.**
The dev server log pins the moment:

```
1:15:44  [vite] (client) Re-optimizing dependencies because lockfile has changed
1:17:51  [vite] (client) ✨ optimized dependencies changed. reloading
```

`node_modules/.vite/deps/_metadata.json` had an mtime of exactly `1:17:51`. Diffing its
`optimized` keys against `optimizeDeps.include` in `vite.config.ts` showed eight dependencies
being discovered lazily rather than pre-bundled at startup: `@shopify/polaris-icons`,
`papaparse`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `@react-email/components`,
`@react-email/render`, `resend` and `sanitize-html`.

Why that is fatal rather than a brief pause:

1. **In dev, React Router emits no stylesheet `<link>` tags at all.** It inlines every
   stylesheet into a single `<style data-react-router-critical-css>` in the SSR document.
   Confirm with `curl -s <url> | sed -n '/<head>/,/<\/head>/p'` — there are no CSS `<link>`s.
2. **`HydratedRouter` deletes that tag on mount, unconditionally**, with no check that
   anything replaced it. See `react-router/dist/development/dom-export.mjs`:
   `setCriticalCss(void 0)` in a mount effect, then
   `document.querySelectorAll('[data-react-router-critical-css]').forEach((element) => element.remove())`.
3. The real styles are expected to arrive separately, as `<style data-vite-dev-id>` tags
   injected by the client module graph — and a dependency re-optimization invalidates the
   `?v=<hash>` module URLs that graph is built from.
4. Vite recovers by calling `location.reload()`. **Top-level that works; inside Shopify's
   embedded iframe it does not.** The page keeps the state it was left in: critical CSS
   deleted, replacement styles never injected.

### Fix

Pre-bundle the late-discovered dependencies at startup by adding them to
`optimizeDeps.include` in `vite.config.ts`, which removes the only observed trigger.

`resend`, `@react-email/*` and `sanitize-html` are server-only. They reach the *client*
optimizer because its scanner crawls the route modules that import the email services, and
`@react-email/render` resolves to its browser build. List them rather than excluding them:
`optimizeDeps` is dev-only and never affects the production bundle, whereas excluding a CJS
package (`sanitize-html` ships CJS) breaks its dev interop.

### Verification

From a cold dep cache (`rm -rf node_modules/.vite/deps`), against the real embedded app:
zero re-optimization events in the dev log, and Dashboard, Reviews and Settings each render
fully styled on first load, after internal navigation, and after a hard refresh.

### Ruled out, each by measurement rather than inspection

- **The HMR websocket.** It connects fine over the tunnel — console shows `[vite] connecting...`
  then `[vite] connected.` The `hmrConfig` branch in `vite.config.ts` is not implicated.
- **CSP, nonce handling, cross-origin.** The app sets no CSP of its own; `grep` for
  `content-security-policy|frame-ancestors|style-src|nonce` across `app/` returns nothing but
  Shopify's own `addDocumentResponseHeaders`.
- **Stylesheet removal in app code.** The only `.remove()` on a DOM node is a CSV download
  anchor cleanup in `app.reviews.tsx`.
- **Stale dev-server processes.** The Shopify CLI assigns Vite its own port (observed: 59118,
  59576), so an unrelated process squatting `:3000` — which `server.port` would otherwise
  default to — never interferes.
- **Slow first navigation to a route.** Clicking a nav item changes the admin URL immediately
  while the iframe still shows the previous screen for several seconds. That is first-load
  module latency over the Cloudflare tunnel, not a navigation defect — it resolves on its own
  and does not occur once the route's modules are warm.
- **`monica-id` / `monica-version` hydration warning.** A browser extension writing attributes
  onto `<body>`, not our markup.
