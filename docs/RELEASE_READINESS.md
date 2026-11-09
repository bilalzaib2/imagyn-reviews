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
