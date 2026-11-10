# QA Test Results

Evidence for what has actually been exercised in Imagyn Reviews, and by what means. Every row
carries the strongest label the evidence supports and nothing stronger.

**Last updated: 2026-11-10.**

---

## The labels, and what each one is worth

| Label | What it proves | What it does NOT prove |
|---|---|---|
| **Implemented** | The code path exists and typechecks. | Nothing about behaviour. |
| **Unit-tested** | Logic behaves as specified against mocked collaborators. | That the collaborators behave that way. |
| **Integration-tested** | Several of our own modules work together, against a real local database. | Anything about Shopify, Resend or a browser. |
| **Browser-rendered** | The screen mounts and paints with realistic data, with no console error. | That any control does anything. |
| **Browser-interaction-tested** | Every reachable control was clicked; no crash, no console error. | Persistence — the harness stubs every action, so nothing reaches a loader, Shopify or the database. |
| **Real Shopify verified** | An actual Admin API call against a real development store returned what we expected. | — |
| **Real email accepted** | Resend accepted the message and returned an id. | That it arrived, or where. |
| **Inbox delivery verified** | The message was seen in the destination inbox, in a named folder. | — |
| **Not verified** | No evidence either way. | — |

A mocked test is not a real Shopify integration test. A rendered component is not proof that a
merchant workflow works. A successful build is not proof of production readiness.

---

## 1. Engineering gates — 2026-11-10

| Gate | Result |
|---|---|
| Unit + integration tests | **2,110 passing / 110 files**, 0 failing, 0 skipped |
| Typecheck (`tsc --noEmit`) | clean |
| Lint (`eslint`) | clean |
| Production build (`react-router build`) | clean |
| Prisma migration status | `migrate status` / `validate` clean; no pending local migrations |
| End-to-end tests | **Not verified** — none exist. There is no browser-driving E2E suite in this repo; the preview harness below is the closest thing and is explicitly not one. |

---

## 2. Browser-rendered — 35 screen states

Rendered through `tools/preview`, which mounts each real route component with realistic
loader data:

```
npx vite --config tools/preview/vite.config.ts   # http://localhost:5199/?screen=<key>
```

Dashboard (+fresh), Reviews (+empty), Customer questions (+empty), Brand Studio (+Free),
Email Studio (+Free), Coupons (+empty), Settings overview, Review requests (+empty, +Free),
Moderation, SEO, Trust, Review rewards (+empty), Referrals, Widgets (fresh, existing, Free),
Analytics (populated, empty, Free), Medals (+fresh), Billing (+trial), Products (+empty,
+error), Settings → Import (+empty), Settings → Product groups, **Product detail (+no
reviews, +not found), Add a review manually, Edit a review (+not this store's)**.

The six in bold were added on 2026-11-10. They are reached by URL rather than by a sidebar
item, so a sweep that walks the navigation never arrives at them — which is why an earlier
claim in this project's handover that every merchant-facing screen was covered was wrong.
Rendering product detail for the first time immediately found a real defect (§4.2).

**Still not rendered:** nothing. The remaining `app.*` routes are resource routes with a
loader and no component (`app.requests.orders`, `app.widgets.add-to-theme`, `app.support`,
`app.reviews.export`, `app.products.sync-status`, `app.billing.manage`) — they render no UI
and are not screens.

---

## 3. Browser-interaction-tested — 218 controls across 8 screens

Every reachable control clicked, in rounds, re-querying the DOM between rounds so controls
revealed by a tab change or an opened drawer are included. Native dialogs are stubbed before
the sweep, because a `confirm()` would block every subsequent command.

| Screen | Controls | Crashes | Console errors |
|---|---|---|---|
| Review management | 16 | 0 | 0 |
| Brand Studio | 14 | 0 | 0 |
| Coupons | 23 | 0 | 0 |
| Email Studio | 79 | 0 | 0 |
| Review requests | 39 | 0 | 0 |
| Widgets | 37 | 0 | 0 |
| Add a review manually | 8 | 0 | 0 |
| Product detail | 2 | 0 | 0 |
| **Total** | **218** | **0** | **0** |

Settings → Overview is excluded on purpose: it is a grid of navigation controls, and clicking
one performs a real top-level navigation out of the harness. It is Browser-rendered, and its
eight targets were read from source and confirmed to match real routes.

**What this does not prove.** The harness stubs every `action`, so no click persisted
anything. Reviews' 16 controls include "Archive" and "Reply"; neither reached the database.

### 3.1 Two apparent failures that were not defects

- **Review requests looked like it crashed** on the fifth control. The real cause was the
  harness: "Send Request" loads `/app/requests/orders` through a fetcher, that route renders
  no UI so it had no harness entry, and React Router answered the fetcher with a 404 whose
  default ErrorBoundary replaced the whole page with "Unexpected Application Error!". A
  catch-all resource-route stub fixed the harness, and the same screen then took 39 controls
  cleanly — including the drawer that fetcher opens.
- **Six unnamed `role="button"` elements on Coupons** turned out to be Polaris's own number-
  input spinner segments, carrying `tabindex="-1"` and therefore outside the accessibility
  tree. Not ours, and not a defect.

### 3.2 One real accessibility defect, fixed

Settings → Overview renders eight navigation buttons, six labelled "Configure". Listed out of
context — how a screen reader's element list presents them — those six were indistinguishable.
`ActionCard` now sets an accessible name carrying the card's title.

Checked and deliberately **not** changed: those controls are `<button>`s, not `<a href>`s, and
zero anchors on a navigation grid looks wrong from the outside. App Bridge intercepts a
same-origin anchor click inside the embedded iframe before the anchor's own handler runs, so a
link navigates nowhere — documented in `ActionCard.tsx` with the production request-log
evidence behind it, and now pinned by test so a later "fix" cannot quietly break every
Settings entry point.

---

## 4. Defects found and fixed — 2026-11-10

### 4.1 An approval could put an archived review back on the storefront

The Archive view renders the same bulk bar as every other view, so "Approve" sits directly
above a list of archived reviews. Both moderation paths wrote `isPublished: status ===
APPROVED` with nothing consulting `archivedAt`, so two clicks produced a review listed in the
Archive *and* live on the storefront, while every statistic went on excluding it.

**Found by:** code reading during the §7 security review. **Fixed and unit-tested** — 7 new
tests, including the plan-cap interaction and the bulk-approve split.

### 4.2 A product's rating counted reviews nobody could see

`Product.averageRating / totalReviews / ratingNCount` were filtered by `LIVE_REVIEW` alone,
which excludes deleted and archived reviews but says nothing about moderation status. A
merchant who rejected a one-star review as spam still saw it dragging down the average on
their own product page.

It survived because no public reader trusts those columns — the storefront, the batch summary
endpoint and the JSON-LD sync each compute their own approved-only figure. So the storefront
and the Google rich snippet were always correct; only the merchant's own screen was wrong.

**Found by:** rendering product detail in the harness for the first time. **Fixed and
unit-tested** — 8 new tests. Needs a backfill after deploy
(`scripts/backfill-product-review-stats.mjs`, dry-run by default).

### 4.3 The app requested nine of its ten declared scopes

`app/shopify.server.ts` builds the authorization request from `process.env.SCOPES`, not from
`shopify.app.toml`. Three scopes added to the toml over 2026-09-08/09/10 were never carried
across: `read_fulfillments`, `read_legal_policies` and — the costly one — `write_discounts`.

Nothing failed until an Admin API call needed the permission, so the first symptom would have
been Shopify rejecting a real discount creation at the moment Coupons was first exercised
against a live store. **Fixed and unit-tested**; `scopes.config.test.ts` now reads both files
and compares them.

---

## 5. Real Shopify verification — blocked, with the blocker now diagnosed

**Status: Not verified.** No Shopify Admin API call can be made from this environment.

What was established on 2026-11-10, first-hand rather than inferred:

| Question | Answer | How |
|---|---|---|
| Is the local offline token stale in our database, or revoked by Shopify? | **Revoked.** | A real Admin API round-trip returned `HTTP 401 — "[API] Invalid API key or access token"`. Only a live call distinguishes these two, and they need different fixes. |
| Is the stored scope set current? | **No** — one short, and that was before fixing §4.3. | Compared the session row's `scope` against the toml. |
| Would reconnecting the Shopify MCP unblock this? | **No.** | `shopifyDiscount.server.ts` calls `unauthenticated.admin(storeDomain)`, which loads the offline session from our own database. Our Shopify code never touches the MCP connector. |
| Is the app's registered configuration intact? | **Yes.** | `shopify app info` reports `applicationUrl: https://app.imagyn.co` — no stale dev override. The CLI is already authenticated (org `129629038`). |
| Is the local database production? | **No.** | `DATABASE_URL` resolves to `localhost:5432/imagyn_reviews_dev`. |

`scripts/verify-dev-store-session.mjs` answers all of the above in one read-only run, and adds
a per-scope read probe and a `shop.plan.partnerDevelopment` check so the development-store
requirement is proven from Shopify's own data rather than from the store's name. It refuses to
run against a non-local database and never prints a token. Current result: **3 of 6 checks
pass**; the three failures are the expired token, the scope gap and the 401.

Blocked behind this: real discount creation, checkout redemption, usage tracking, expiry and
revocation, storefront widget rendering, theme compatibility, and the full review-collection
journey.

---

## 6. Email verification

| Workflow | Label | Evidence |
|---|---|---|
| Customer review request — From/Reply-To header composition | **Unit-tested** | `emailSenderIdentity.server.test.ts`, `email.shared.test.ts` |
| New review notification — Reply-To is the reviewer | **Unit-tested** | `reviewNotifications.server.ts` + tests; the reviewer's address is validated through `isHeaderSafeAddress` first |
| Provider acceptance | **Real email accepted** | Four messages accepted by Resend with ids returned |
| Inbox placement | **Not verified** | Provider acceptance is not delivery. Nothing has been seen in an inbox, and no folder has been named. |

Only `bilal.zaib@outlook.com` has ever been used for real delivery tests.

---

## 7. Security review — 2026-11-10

Audited by reading every relevant path and probing for the specific failure.

| Area | Finding |
|---|---|
| Shopify webhook HMAC | **Sound.** All five Shopify webhook routes go through `authenticate.webhook(request)`, which verifies the signature before any handler code runs. |
| Resend webhook signature | **Sound.** Svix scheme verified by hand over the raw body: exact-bytes read (not parse-then-reserialize), 5-minute timestamp tolerance, length-checked `timingSafeEqual`, multiple `v1,` candidates for key rotation, and a hard reject when the secret is unset. |
| Idempotency | **Sound.** `fulfillments/create` relies on a unique constraint and detects `P2002` rather than racing a read. The Resend handlers are forward-only no-ops on replay. |
| Discount ownership | **Sound.** Every `couponsService` method resolves the record with `{ id, storeId }` before acting — verify-then-act, not trust-the-id. |
| Public endpoint abuse | **Sound.** `api.reviews.vote` requires a valid App Proxy signature, then *still* resolves the shop and scopes the vote to that store, because a valid signature only proves "some installer forwarded this". Then IP-bucketed throttling, because `visitorId` is client-minted. |
| Email header injection | **Sound.** The riskiest input is the new-review notification's Reply-To, which is a *shopper-supplied* address. It passes through `isHeaderSafeAddress`, which rejects whitespace (so CR/LF), `<`, `>`, `,`, `;`, `"` and multiple `@`. |
| Public PII exposure | **Sound.** No public read selects `reviewerEmail`, `reviewerLocation` or `askerEmail`. |
| Archived/hidden filtering | **One defect, fixed** — §4.1. The public-read side was already correct and is pinned by test across seven modules. |
| Public sharing default | **Opt-in.** `publicNetworkEnabled` is checked `=== false` rather than for truthiness, and development stores are excluded outright. No merchant setting was changed. |
| Tenant isolation | **Sound** on every path read. Cross-tenant ids are silently excluded from bulk operations rather than throwing, so a bulk action cannot even reveal that another store's review exists. |

---

## 8. What remains unverified, plainly

- Everything in §5 — all real Shopify behaviour.
- Inbox placement for every email.
- Any behaviour in the real embedded Shopify admin: production still runs the pre-work build,
  so no change made since 2026-11-06 has been seen inside Shopify Admin.
- Persistence of any control exercised in §3.
- Shopify Managed Pricing showing $9.99 / 7 days — needs a human to look at the dashboard.
- Theme app extension rendering on a real storefront.

---

## 2026-11-11 — real development-store integration testing and the hydration fix

Session state: offline session verified **13/13** (`scripts/verify-dev-store-session.mjs`),
including live Admin API read probes per scope and `shop.plan.partnerDevelopment = true`.

### Real Shopify verified

Evidence label: **Real Shopify verified** — driven against the live Admin API on
`verveonline.myshopify.com`, asserted by reading state back from Shopify rather than trusting
a mutation's return value. Re-run clean twice.

| Workflow | Script | Result |
|---|---|---|
| Discount create / read-back by code / revoke / resume / usage count / delete | `scripts/e2e-shopify-discounts.ts` | **18/18** |
| Orders + customers query, fulfilment filter | `scripts/e2e-shopify-data.ts` | pass (0 orders on store — see blocked) |
| `reviews_jsonld` product metafield — written, valid JSON, `@type: Product`, real `aggregateRating` | `scripts/e2e-shopify-data.ts` | pass (3.5 / 2 reviews, matches local DB) |
| Files upload — staged upload → fileCreate → poll → CDN URL fetched over HTTP → listed → deleted | `scripts/e2e-shopify-data.ts` | **14/14** |

Specifics pinned because they silently break real redemption: 10% is stored as Shopify's `0.1`
fraction and not `10`; `usageLimit`, `appliesOncePerCustomer` and minimum subtotal round-trip;
an unknown code reads `null` rather than `0`, which is the distinction `referrals.server.ts`
depends on to tell "never created" from "created but unused".

All test artifacts were deleted and re-verified gone (`scripts/cleanup-e2e-shopify-artifacts.ts`:
0 matching files, 0 matching discounts).

### Real email accepted

Both flows accepted by Resend with message ids, to `bilal.zaib@outlook.com` only.
**Not** inbox delivery verified — that needs a human looking at the mailbox.

### Browser-interaction-tested — the unstyled dashboard

Measured from inside the embedded iframe by having the page POST its own stylesheet census to
the dev server (the iframe is cross-origin; its DOM and console cannot be read from the admin
page, and `read_network_requests` does not cross that boundary either).

Before: `/app` unstyled on repeated loads; `/app/email-studio` and `/app/appearance` at 0 rules.

After both fixes:

| Screen | Loads | Unstyled |
|---|---|---|
| `/app` | 15 final-state samples, across 10 cold loads + 10 hard refreshes | **0** |
| `/app/reviews` | 1 | 0 |
| `/app/settings` | 1 | 0 |
| `/app/settings/requests` | 1 | 0 |
| `/app/email-studio` | 1 | 0 |
| `/app/appearance` | 1 | 0 |

0 hydration failures, 0 `Expected server HTML` mismatches, 0 Vite re-optimization events.

**Production was never affected.** Verified against a real production build: the served HTML
carries ordinary `<link rel="stylesheet">` tags (42 CSS assets emitted) and **zero**
`data-react-router-critical-css` occurrences. The mechanism that loses the stylesheets is
development-only.

### Not verified — and why

| Item | Status | Reason |
|---|---|---|
| Coupon redemption at checkout | **Blocked** | Needs a real order. Storefront is password protected and the app holds `read_orders`, not `write_orders`. |
| Storefront widget rendering | **Blocked** | Storefront 302s to `/password`. A development-plan store cannot turn this off. |
| Order-triggered review requests | **Blocked** | The development store returns 0 orders. |
| Theme extension activation | **Blocked** | No `read_themes` scope, and the storefront cannot be read. Now reported honestly as `blocked` rather than claimed — see the override removal below. |
| Email inbox placement | **Not verified** | Provider acceptance is not delivery. |

### Theme extension status — claim withdrawn

`MANUAL_VERIFICATION_OVERRIDES` asserted four blocks as `installed` for this store on the
strength of a Theme Editor check dated **2026-08-16 against theme 150727819563**. The Shopify
CLI now reports the host theme as **193495335211** — a different theme. The table is removed;
no shop domain is special-cased anywhere in detection. Those four blocks now report `blocked`
("your storefront is password protected, verify in your Theme Editor") instead of
"Live on your theme". Lower confidence, higher honesty.
