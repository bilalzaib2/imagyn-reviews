# Imagyn Reviews — release readiness

**Date:** 2026-11-10
**HEAD:** local `main`, 35 commits ahead of `origin/main`, mirrored to
`origin/backup/night-shift-2026-11-09`
**Gates:** 2,044 tests / 104 files, typecheck, lint, production build — all clean
**Deployed:** nothing. Production runs `f4097c4`, the build from before this work began.

---

## 1. What each status means here

The word "verified" has been used loosely in earlier reports. It is defined precisely now,
because the difference decides whether this app is safe to launch.

| Status | Means |
|---|---|
| **Verified** | Exercised against something real — a real database, the real email provider, or rendered and measured in a browser. The evidence is named in the row. |
| **Partial** | Works, but materially narrower than Judge.me, or only part of the flow is proven. |
| **Not verified** | Code and tests exist. Never exercised end to end in the real embedded Shopify admin. |
| **Missing** | No implementation. |

**The single most important caveat:** no code written since 2026-11-06 has run in the real
embedded Shopify admin. Production still serves the pre-work build, and deploying needs the
owner's approval. Everything marked Verified was verified by one of the three means above —
**not** by a merchant using it in Shopify.

### What the preview harness does and does not prove

`tools/preview` mounts the real route components with the real stylesheets against fixture
data. It genuinely proves **layout, typography, density, responsive behaviour, empty states
and render-time crashes** — all measured, not eyeballed. It does **not** exercise loaders,
actions, App Bridge or Shopify. A row proven only by the harness says so.

---

## 2. Review management and moderation

| Feature | Judge.me | Imagyn | Status | Evidence |
|---|---|---|---|---|
| Workspace tabs | Reviews · Requests · Questions | all three | **Verified** | rendered; every tab asserted to point at a real route file |
| Review table | not observable (their store is empty) | 6 columns, container-responsive | **Verified** | measured in browser; column widths, shedding order and clamps all checked |
| Detail panel | not observed | second column ≥64rem, drawer below | **Verified** | rendered at 1200px and 400px |
| Status tabs with counts | yes | yes, incl. Archive | **Verified** | rendered; counts from one grouped query |
| Approve / reject | yes | yes | **Not verified** | unit-tested; never clicked in the real admin |
| Bulk moderation | yes | approve, reject, delete, archive, restore | **Not verified** | unit-tested only |
| Hide with a reason | **required** by Judge.me | fixed reason list, single + bulk | **Verified (data)** | round-tripped against the real database in a rolled-back transaction |
| Archive / restore | per-review only | single **and bulk** | **Verified (data)** | 15 end-to-end checks against the real database |
| Filters | 8 incl. sentiment, topics, tags | status, rating, product, date, verified | **Partial** | source, type, sentiment, topics, tags missing |
| Product vs Store reviews | separate tabs | not modelled | **Missing** | needs a migration |
| Spam view | a hide *reason*, surfaced as a tab | reason stored, no tab | **Partial** | the data exists; the view does not |
| Search / sort / pagination | yes | server-side cursor | **Not verified** | unit-tested |

## 3. Review requests

| Feature | Judge.me | Imagyn | Status | Evidence |
|---|---|---|---|---|
| Scheduling | **3 segments** (domestic / international / POS) | one global delay | **Partial** | real gap; needs a migration |
| Per-product timing | yes (paid) | — | **Missing** | |
| Trigger | after fulfilment | after fulfilment | **Not verified** | |
| Reminder chain | per segment | yes, not segmented | **Partial** | |
| Requests screen | yes | yes | **Not verified** | not yet in the harness |

## 4. Email

| Feature | Judge.me | Imagyn | Status | Evidence |
|---|---|---|---|---|
| Real delivery | — | Resend | **Verified** | 4 emails accepted with message ids to the authorised test inbox |
| From header | — | merchant-scoped on every plan | **Verified** | observed live: `Verve Outdoor <requests+verveoutdoor.com@notifications.imagyn.co>` |
| Reply-To | — | verified store → template → Shopify contact → platform | **Verified** | precedence observed live; header-safety hardened |
| Email Studio screen | — | 4 template types, 5 presets, live preview | **Verified (layout)** | rendered; missing `<h1>` found and fixed |
| Request templates | a creatable **list** | exactly one | **Partial** | |
| Media reminder | paid | — | **Missing** | |
| **Coupon reminder** | paid | — | **Missing** | chases unredeemed codes; direct revenue impact |
| Inbox placement | — | — | **Not verified** | DMARC still `p=none`, no domain reputation. Acceptance ≠ delivery |

## 5. Brand Studio and storefront

| Feature | Judge.me | Imagyn | Status | Evidence |
|---|---|---|---|---|
| Brand themes | 1 colour + icon | **5 distinct themes**, contrast-tested | **Verified (layout)** | rendered with real default tokens |
| Auto-fetch brand from Shopify | does not do it either | **impossible** | **N/A** | Admin API has no `Shop.brand`; verified in both API references |
| Logo upload | manual | manual | **Not verified** | flow never exercised |
| Widgets screen | ~22 widget gallery | gallery with previews | **Verified (layout)** | rendered in fresh, existing and Free states |
| Widget install detection | reads the theme | **two mechanisms** | **Partial** | server-side detector + App Bridge `extensions()`; neither confirmed against a live theme |
| Honest unknown state | — | yes | **Verified** | rendered: shows the real reason rather than claiming not-installed |
| Actual storefront output | — | theme app extension | **Not verified** | never loaded a storefront page |

## 6. Coupons and rewards

| Feature | Judge.me | Imagyn | Status | Evidence |
|---|---|---|---|---|
| Real Shopify discounts | yes | `discountCodeBasicCreate` etc. | **Not verified** | integration is sound in code; no discount created against a live shop in this work |
| Create / activate / pause / end | yes | yes | **Not verified** | |
| Issue a code | yes | yes | **Not verified** | |
| **Revoke an issued code** | not documented | yes | **Verified (layout)** | service was complete but had **no caller**; wired and rendered |
| **Real redemption count** | `asyncUsageCount` | yes | **Verified (layout)** | reports failure rather than a fabricated "0 uses" |
| Edit a campaign | yes | **no** | **Missing** | `updateCoupon` exists, no edit form |
| Tiering by review type | yes | gates only | **Partial** | |
| Discount combinations | yes | — | **Missing** | |
| Rating-gated rewards | **absent** (compliance) | **removed** | **Verified** | structurally guarded; 16 CFR Part 465 |

## 7. Analytics, Q&A, SEO

| Feature | Judge.me | Imagyn | Status | Evidence |
|---|---|---|---|---|
| Analytics screen | tiles drive one chart | metrics + charts | **Verified (layout)** | rendered populated, empty and Free; no NaN leakage |
| Revenue attribution | its own tab | — | **Missing** | |
| Customer questions | paid | full model + screen | **Verified (data)** | 13 end-to-end checks against the real database |
| Q&A storefront widget | yes | — | **Missing** | read side (`getPublicQuestions`) exists |
| Q&A notification email | yes | — | **Missing** | |
| SEO / rich snippets | yes | yes | **Not verified** | |
| Public review network | Reviews Site | opt-in since 2026-11-08 | **Verified (data)** | default flipped and existing rows reset |

---

## 8. Blocking issues for release

1. **Nothing is verified in the real embedded admin.** Every UI fix since 2026-11-06 is proven
   by rendering or by database round-trips, not by a merchant in Shopify. This is the single
   largest risk and it cannot be closed without a deploy.
2. **Coupon lifecycle has never run against a live Shopify shop in this work.** It creates real
   discounts and real money comes off real orders.
3. **Inbox placement is unproven.** DMARC is `p=none` with no domain reputation.
4. **A campaign cannot be edited after creation.**
5. **Deploying will turn public sharing off for every existing merchant** — deliberate, approved,
   and irreversible per-merchant because the old flag was never a consent record.

## 9. Not blocking, but honest

Missing versus Judge.me: product-vs-store reviews, a Spam view, segmented request scheduling,
multiple request templates, media and coupon reminder emails, coupon tiering and combinations,
revenue attribution, a Q&A widget and its notification, Bundles, Collection flow, Optimize
collection, Language.

Ahead of Judge.me: bulk archive, AI reply drafting with tone, configurable coupon expiry,
one-tap star ratings in request emails, and an honest unknown state for widget installation.

---

## 10. Addendum — 2026-11-10 (later)

### 10.1 Defects found and fixed since §1

| Screen | Defect | Evidence |
|---|---|---|
| Review requests | Order numbers rendered `##1040` — the column prefixed `#` unconditionally, but Shopify's `fulfillment.name` already carries one, so **every automatically-created request** was affected | rendered; now `#1040` |
| Review requests | Ten columns in 671px (Order 34px, Scheduled 42px) beside a permanent detail panel | staged shedding; Customer 76→134px, Scheduled 42→74px |
| Brand Studio | Logo was a URL field only | real file upload, shared limits, specific error states |
| Settings (all) | Submit buttons stretched to the full column | fixed at the Section layer, 1160→64px |
| SEO settings | An invalid stored date threw during render, blanking the page | hardened to an em dash |

### 10.2 Screens now rendered and inspected

Dashboard (populated + fresh), Reviews (+ empty), Customer questions (+ empty), Brand Studio
(+ Free), Email Studio (+ Free), Coupons (+ empty), Settings overview, Review requests
(+ empty, Free), Moderation, SEO, Trust, Review rewards (+ empty), Referrals, Widgets (fresh,
existing, Free), Analytics (populated, empty, Free), Medals (+ fresh), Billing (+ trial).

Not yet rendered: Products, Settings → Import, Settings → Product groups.

### 10.3 Two commercial questions for the owner

1. ~~Pro price discrepancy~~ — **resolved 2026-11-10. $9.99/month is the confirmed,
   owner-locked Pro price.** An earlier note in this file wrongly recorded the target as $15;
   that was my error, not a defect in the product. The code was right all along. See §11.
2. **The pricing page sells two features marked "Coming soon"** — Advanced email styling and
   Advanced analytics. They are honestly labelled, but they are bullets under a paid plan.

### 10.4 Confirmed correct, not changed

- The two-tier lock works: `scale` is defined for existing subscribers but excluded from
  `PLAN_ORDER`, so neither `getAllPlans()` nor the billing page ever renders it.
- Email Studio's "JPEG, PNG, WebP or SVG" message looks inconsistent with its raster
  allowlist but is correct — SVG takes a separate validate-and-rasterize path first.
- Review rewards offers no rating condition and explains why, visible in the rendered UI.

---

## 11. Pricing — audited and confirmed, 2026-11-10

**Free $0 · Pro $9.99/month, 7-day trial.** Owner-confirmed. `$9.99` is correct everywhere and
is the locked price.

### What the audit covered

| Surface | Finding |
|---|---|
| `app/services/billing/plans.ts` | `$9.99`, the single source of truth — **correct** |
| Billing page | formats from `plan.price`; never hardcoded — **correct** |
| Widgets upgrade note | reads `getPlan("growth")` via `proPlanSummary()` — **correct** |
| Every other `$` literal in the app | one only: `$48.00`, a mock product price inside a widget preview — **not a plan price** |
| `scale` tier at `$29.99` | defined for existing subscribers, excluded from `PLAN_ORDER`, never rendered — **correct** |
| Shopify Managed Pricing | **not inspected and not modified** — it is outside this repository and changing it needs owner approval |

### Three things were wrong, all now fixed

1. **A `$15` reference in this very document.** My own error in the 2026-11-10 addendum, which
   recorded the locked price as $15. The product was right; the report was wrong. Corrected.
2. **`docs/PROJECT_STATE.md` claimed a 14-day trial.** `plans.ts` says 7, with a comment that
   it must equal the Managed Pricing setting. Corrected to 7.
3. **Two screens formatted the price differently** — billing used `toFixed(2)`, the widgets
   upgrade note interpolated the raw number. At $9.99 both read identically, so the
   divergence was invisible; at a whole-number price one would have said "$10.00" and the
   other "$10". Both now use `formatPlanPrice()`.

### Remaining `$15` references are correct

Four mentions of $15 remain, in `JUDGEME_PARITY_AUDIT.md`, `JUDGEME_COMPETITIVE_RESEARCH.md`
and `IMAGYN_REVIEWS_SESSION_HANDOVER.md`. Every one is **Judge.me's** Awesome-tier price,
used for comparison. They are accurate competitor data and were left alone.

`docs/CHANGELOG.md` keeps its historical three-tier entry — rewriting history would be worse —
with a note that the tier names have since changed.

### Locked by test

`plans.test.ts` now asserts `getPlan("growth").price === 9.99` exactly, rather than merely
"greater than zero". A silent change would reprice the product on every screen that quotes it,
and the value must stay equal to the Shopify Managed Pricing setting, which this repository
cannot read.

**Still requires a human check:** that Managed Pricing in the Partner Dashboard also says
$9.99 with a 7-day trial. Nothing in this repo can verify that.

---

## 12. Addendum — 2026-11-10 (later)

Evidence for everything here is in `docs/QA_TEST_RESULTS.md`, which this section does not
duplicate. Gates at this checkpoint: **2,110 tests / 110 files**, typecheck, lint and
production build clean. 48 commits ahead of `origin/main`; nothing pushed to `main`, nothing
deployed.

### 12.1 Four defects found and fixed

| Defect | Severity | How it was found |
|---|---|---|
| An approval could put an archived review back on the storefront, two clicks from the Archive view, while every statistic went on excluding it | **High** — merchant-visible, storefront-visible | Code reading during the security review |
| A product's own rating averaged in reviews the merchant had rejected. Merchant screen only — every public reader computes its own approved-only figure, so the storefront and the Google rich snippet were always correct | **Medium** | Rendering product detail in the harness for the first time |
| The app requested nine of its ten declared scopes, `write_discounts` among them. Every Coupons discount call would have been rejected the first time it ran against a live store | **High, latent** — would have presented as a Coupons bug | Comparing `.env` against `shopify.app.toml` while diagnosing the OAuth blocker |
| Six of eight Settings → Overview buttons were indistinguishable in a screen reader's element list | **Low** | Interaction sweep |

Each is covered by new tests: 7, 8, 6 and 4 respectively.

### 12.2 Three screens had never been rendered

`app.products_.$id`, `app.reviews_.new` and `app.reviews_.$id.edit` are reached by URL rather
than by a sidebar item, so a nav-driven sweep never arrived at them. An earlier claim in this
project's handover that every merchant-facing screen was covered was therefore wrong, and is
corrected rather than restated. All six states (including both not-found paths) are now
rendered, and the first render found the defect in §12.1 row 2.

### 12.3 The release blocker is unchanged, but is now precisely diagnosed

**Still blocking:** no Shopify Admin API call can be made from this environment, so nothing in
the coupon lifecycle, the storefront widget output, theme compatibility or the review-
collection journey is **Real Shopify verified**.

What changed is that the cause is now established rather than assumed — the token is *revoked*
by Shopify (proved by a live 401, not inferred from a stored expiry date), reconnecting the
Shopify MCP would not help (our code reads the offline session from our own database), the
app's registered configuration is intact, and the existing development app is the correct one
to re-authorise. An earlier recommendation in this project to create a separate development
app was based on a risk this repo's own incident record contradicts; see handover §22.8.

One owner action unblocks it, and `scripts/verify-dev-store-session.mjs` will say in one
read-only run whether it worked.

### 12.4 Two items still need a human, not more engineering

- **Shopify Managed Pricing** showing Free $0 / Pro $9.99 / 7-day trial. The app code is
  audited and locked by test (§11); the hosted pricing page itself has never been looked at.
- **Inbox placement.** Four emails were accepted by Resend. Nothing has been seen in an inbox
  and no folder has been named, so this stays **Real email accepted** and not **Inbox delivery
  verified**.

### 12.5 One deferred write

`scripts/backfill-product-review-stats.mjs` must run after the §12.1 rating fix deploys, or
products not touched by a later review mutation keep their old figures. It is dry-run by
default, refuses a non-local database, and has **not** been applied anywhere. It needs owner
approval.

---

## §13 Addendum — 2026-11-11 (real Shopify testing, hydration fix, theme-status withdrawal)

### Readiness movement

**Net: forward.** The Shopify authentication blocker that gated every real integration test is
cleared (session verified 13/13, all ten declared scopes granted and probed live), and the
first real end-to-end workflow — the full coupon/discount lifecycle — is now verified against
Shopify rather than mocks.

### Corrections to earlier entries in this document

1. **The unstyled dashboard is not a launch blocker.** It was reported as one earlier today.
   It is a development-only defect: React Router's critical-CSS mechanism is dev-only, and a
   real production build was checked and ships ordinary stylesheet links (42 CSS assets, zero
   `data-react-router-critical-css` occurrences). It is fixed regardless — two hydration
   mismatches, in `Metric` and `ContextualSaveBar`.

2. **The Vite dependency re-optimization was not the root cause.** §12's successor entry
   claimed it was. It was a contributing trigger only; the fix for it is kept because the
   mechanism is real, but the actual cause was a failed hydration. See the correction at the
   top of the 2026-11-11 incident in `TROUBLESHOOTING.md`.

3. **Four theme blocks are no longer reported as installed on this store.** Previously they
   read "Live on your theme" from a hardcoded override whose evidence was a 2026-08-16 Theme
   Editor check against a theme that is no longer the host theme. That claim is withdrawn.

### Launch blockers

| # | Blocker | Owner action |
|---|---|---|
| 1 | Checkout redemption unverified | Needs a real order on a store whose storefront can be reached. Requires either a non-development store or the storefront password. |
| 2 | Storefront widget rendering unverified | Same root constraint — the storefront 302s to `/password`. |
| 3 | Theme extension activation unverifiable | No `read_themes` scope and no storefront access. Either grant the scope or confirm manually in the Theme Editor and re-record with a current theme id. |
| 4 | Email inbox placement unverified | Human check of `bilal.zaib@outlook.com`. Provider acceptance is recorded; delivery is not. |
| 5 | Order-triggered review requests unverified | The development store has 0 orders. |

### Not blockers (explicitly)

- The unstyled dashboard (dev-only, fixed, verified across 20 loads).
- The AS23674 API-activity alert — investigated, matches our own testing, no compromise; see
  `SECURITY.md`.

### Gates at this entry

`Test Files 111 passed · Tests 2115 passed` · typecheck clean · lint clean · production build
clean · `prisma migrate status`: 42 migrations, database schema up to date, 0 pending.

---

## §14 — 2026-11-11 checkpoint: CSS incident closed, blocker status by evidence class

### Checkpoint

Branch `checkpoint/imagyn-reviews-2026-11-11` created at `dac2483`, verified to point at the
exact HEAD. **Local only — not pushed.** `backup/night-shift-2026-11-09` is unchanged at
`7160ae8` locally and on the remote, and verified an ancestor of HEAD.

### CSS incident — closed

50 instrumented loads across six screens, including 9 under up to 300 ms of injected per-request
latency: **0 unstyled, 0 hydration failures, 0 mismatches, 0 console errors.** Production proven
unaffected from a build served locally — ordinary `<link rel="stylesheet">` tags, all serving
200 `text/css`, zero critical-CSS nodes. Full evidence in `TROUBLESHOOTING.md`.

**This was never a production defect.** It was reported as a launch blocker earlier in the day;
that was wrong, and it is withdrawn.

### Launch blockers by evidence class

| Workflow | Implemented | Automated-test verified | Real Shopify verified | Browser verified | Blocked |
|---|---|---|---|---|---|
| Discount create / activate / revoke / resume / usage / delete | yes | yes | **yes** (18/18) | — | — |
| JSON-LD product metafield sync | yes | yes | **yes** | — | — |
| Files upload (photo/video review media) | yes | yes | **yes** (14/14) | — | — |
| Orders / customers data layer | yes | yes | **yes** (queries accepted) | — | store has 0 orders |
| Merchant admin UI (6 screens) | yes | yes | — | **yes** (50 loads) | — |
| Widget install detection | yes | yes | — | — | storefront password |
| Theme extension activation | yes | yes | — | — | no `read_themes` + storefront password |
| Storefront widget rendering | yes | yes | — | — | storefront 302s to `/password` |
| Review collection via storefront | yes | yes | — | — | storefront password |
| Checkout coupon redemption | yes | yes | — | — | needs a real order; `write_orders` not held |
| Order-triggered review requests | yes | yes | — | — | store has 0 orders |
| Email request + reminder | yes | yes | accepted by provider | — | inbox placement unverified |
| Merchant onboarding / fresh install | yes | yes | — | — | needs an uninstall/reinstall cycle (owner approval) |

Nothing in the "Real Shopify verified" column is asserted without a read-back from Shopify.
Nothing is marked verified on the strength of a passing unit test alone.

### What actually gates launch

Every remaining blocker reduces to **three access constraints**, not to unfinished product:

1. **The development store's storefront is password protected** and a development-plan store
   cannot turn that off. This blocks widget rendering, review collection, install detection and
   theme activation in one stroke.
2. **No orders exist on the store, and the app holds `read_orders`, not `write_orders`.** This
   blocks checkout redemption and order-triggered requests.
3. **Inbox placement needs a human** looking at `bilal.zaib@outlook.com`.

### Gates

`Test Files 111 · Tests 2115 passed` · typecheck clean · lint clean · production build clean ·
42 migrations, schema up to date, 0 pending.
