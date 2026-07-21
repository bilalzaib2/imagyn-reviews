# SHOPIFY_DEV_WORKFLOW.md

How this project uses the Shopify CLI, in practice — written after the 2026-07-21 incident where a leftover `shopify app dev` session broke the embedded app for the rest of the day. See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#incident-2026-07-21-embedded-app-broken-after-development-work) for the full incident writeup.

---

## The two deployment surfaces, and why they're independent

This app has **two separate things that get deployed, on two separate systems**, and confusing them is the root of most workflow mistakes here:

| | Web app (React Router / admin + storefront API routes) | Extensions + app configuration |
|---|---|---|
| Hosted on | Railway | Shopify's own platform (theme app extension assets, CDN) |
| Deployed by | `git push` → Railway auto-deploys from the connected branch | `shopify app deploy` (+ `shopify app release`) |
| Config source | Environment variables, `.env` | `shopify.app.toml`, `extensions/*/shopify.extension.toml` |
| What breaks if stale | The Node server itself (would show as 500s, Railway logs) | `application_url`, redirect URLs, theme app extension assets, metafield definitions, webhook subscriptions |

**A `git push` never touches Shopify's side.** `shopify.app.toml` changes (new metafields, redirect URLs, the app's registered `application_url`) and `extensions/` changes (theme blocks, JS/CSS assets) sit inert locally until an explicit `shopify app deploy`.

## The dev-preview override — the thing that caused the incident

Running `shopify app dev` does a **third** thing, independent of both surfaces above: it temporarily points the embedded app's iframe URL, **for whichever development store you targeted**, at a local tunnel (Cloudflare) instead of at the app's real registered `application_url`.

This override:
- Is tracked **per development store**, not per app version.
- Is **not released by stopping the process** — not even via a clean `SIGINT` shutdown. Confirmed directly: killing the dev server gracefully left the (now-dead) tunnel URL registered, and the embedded app stayed broken until explicitly cleaned up.
- Is **not released by deploying a new app version** either. `shopify app deploy` + `shopify app release` update the app's *active version* config, but do not retroactively clear an existing store's dev-preview override.
- **Is** released by one specific command: `shopify app dev clean`.

### Standing rule

**Always run this before you're done with a dev session, every time, no exceptions:**

```bash
shopify app dev clean --store=<the store you were just testing on>
```

Not just when you remember, not just when something looks broken afterward — always. The failure mode here is silent: the dev server can be killed cleanly, and there's no obvious signal (except a broken embedded app, later, possibly hours later) that the override is still active.

If you forgot and only realize later, running it retroactively still works — it doesn't matter how long ago the dev session ended.

## Command reference, as actually used in this project

```bash
# Start a dev session (creates a tunnel, temporarily overrides the embed URL
# for --store; also runs the pre-dev command from shopify.web.toml)
shopify app dev
shopify app dev --theme=<theme-id>   # when testing against a specific theme

# ALWAYS run this when done, before doing anything else Shopify-related
shopify app dev clean --store=<dev-store>.myshopify.com

# Create a new app version WITHOUT making it live — use this to inspect
# exactly what will publish before committing to it
shopify app deploy --no-release --message "<description>"

# Inspect the created version in full before releasing:
#   https://dev.shopify.com/dashboard/<org-id>/apps/<app-id>/versions/<version-id>
# Confirm application_url, redirect URLs, extension contents, metafields — all
# of it is shown there, verbatim, before anything goes live.

# Once confirmed, make it live
shopify app release --version=<version-name>
# In non-interactive contexts (CI, or an agent's shell with no TTY):
shopify app release --version=<version-name> --allow-updates

# Read-only checks, safe to run anytime
shopify app info                # local config summary
shopify app versions list       # deployed version history
```

## Verifying which URL is actually live, when in doubt

Don't assume — check directly. From inside the embedded admin (top-level browser context, not the app's own iframe):

```js
document.querySelector('iframe[name="app-iframe"]').src
```

The origin should be `https://imagyn-reviews-production.up.railway.app`. If it's a `trycloudflare.com` URL instead, a dev-preview override is active — run `shopify app dev clean`.

## What the Admin API and Dev Dashboard do *not* expose

Confirmed during the incident investigation, so it isn't re-derived next time: neither the Admin GraphQL API (`AppInstallation`, `App` types — fully introspected) nor the Dev Dashboard's `Settings` or `Installs` pages expose the live dev-preview override or the installation's actual embed URL as queryable data. The only way to know the real state is to check the iframe `src` directly (above), or trust `shopify app dev clean`'s own success message.

## Reinstalling is not the fix

It's tempting to reach for uninstall/reinstall when something in the embed looks wrong. For this specific failure mode (dev-preview override), **don't** — it's undocumented as an intended fix (found only as an anecdotal community workaround, explicitly called out by the reporter as *not* expected behavior), it's meaningfully more disruptive (uninstall webhooks, re-consent, potential session side effects) than the one-line documented command, and it wasn't necessary even once during this incident.
