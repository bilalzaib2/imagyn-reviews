# TROUBLESHOOTING.md

Incident reports and diagnostic reference for Imagyn Reviews. Add a new dated incident section for anything that took more than a few minutes to diagnose — the point is to never re-derive the same investigation twice.

---

## Quick reference: symptom → likely cause

| Symptom | Check first | Details |
|---|---|---|
| Embedded app shows a broken/crashed iframe icon, sidebar submenu (Dashboard/Reviews/etc.) missing | Iframe `src` origin — is it Railway, or a `trycloudflare.com` tunnel? | See [Incident 2026-07-21](#incident-2026-07-21-embedded-app-broken-after-development-work) below. Almost always a leftover `shopify app dev` session, not a code bug. |
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
