# Overnight Completion Report (2026-10-28 → 29)

Unattended session. Every claim below is backed by a command output, a deployment record, or a
live HTTP response taken during the session. Historical reports from earlier sessions were
treated as leads and re-verified, not trusted.

**No customer email was sent. No merchant data was changed. No migration ran. No production
schedule was modified. No credential was rotated. Pure Nutrition was not touched.**

---

## 1. Status summary

| # | Item | Status |
|---|---|---|
| 1 | Public-discovery consent defect (PR #5) | **DEPLOYED AND VERIFIED** |
| 2 | `canUseAdvancedEmailStudio` entitlement | **VERIFIED — no defect, no change made** |
| 3 | Reward issuing safety (PR #3) | **DEPLOYED AND VERIFIED** |
| 4 | Resend webhook / bounce + complaint suppression (PR #4) | **DEPLOYED AND VERIFIED** |
| 5 | Scheduler reachability (PR #2) | **DEPLOYED AND VERIFIED** |
| 6 | Shopify Partner Dashboard API-version warning | **RESOLVED — evidence recorded** |
| 7 | Email Studio capabilities | **ALREADY IMPLEMENTED — no rebuild** |
| 8 | Competitor research | **ALREADY EXISTED — refreshed with 2026 deltas** |
| 9 | End-to-end email delivery | **BLOCKED — needs an authorized test recipient** |

---

## 2. Deployed commits and deployment records

`main` is linear. Zero merge commits across the whole engagement.

| Commit | PR | Railway deployment | Verified |
|---|---|---|---|
| `c8804be896cffa34fafd720ca122c2419a339e0e` | #5 | `1b5481ea` SUCCESS | activeDeploy commitHash exact match |
| `0ca1c1fb7cede5f77047398ce582446a08df0d0f` | #4 | `e9bc6588` SUCCESS | activeDeploy commitHash exact match |
| `d62a315e0858abcaaf98ea07eabde7fe53a75b7c` | #3 | `861806f7` SUCCESS | activeDeploy commitHash exact match |
| `abe3ba69e8bf2a611104be162827502a683bec4a` | #2 | `7548eab7` SUCCESS | activeDeploy commitHash exact match |

Every merge was `git merge --ff-only` followed by a plain `git push`. No force-push. All
reviewed SHAs preserved byte-for-byte.

---

## 3. The consent fix, verified against live production

`publicDiscovery.server.ts` gates every public surface on
`{ isDevelopmentStore: false, publicNetworkEnabled: true }` and promises that turning the
control off *"removes the store, its products and its reviews from every public surface"*.
`/reviews-site/:slug` is a public surface and ignored it, resolving by slug alone.

Live read-only `GET`s after deployment:

```
DEVELOPMENT stores (isDevelopmentStore = true) — now excluded
  verveonline                     HTTP 404
  gilded-lily-jewelry             HTTP 404
  app-review-2a32b753-r71343-a0   HTTP 404

PRODUCTION stores (isDevelopmentStore = false) — unaffected
  gracestoreofficial              HTTP 200
  zebaaish-online                 HTTP 200
  qz1ykx-ak                       HTTP 200

Unknown slug (control)            HTTP 404
reviews.imagyn.co                 HTTP 200
```

Store inventory at verification time (read-only query): 10 stores — 6 development, 4
production, **none currently opted out**, so the `publicNetworkEnabled = false` branch has no
live example and is covered by unit tests only.

> **Behavioural consequence worth knowing:** the six development stores' public review pages
> now return 404, including `verveonline` and `gilded-lily-jewelry`. That is the documented
> policy working as intended, but if either slug was being used as a demo link, it has stopped
> working. Reversible by setting `isDevelopmentStore = false` on a store that is genuinely
> production.

Two of the five regression tests pin the inverse case — an unset `publicNetworkEnabled`
(schema default `true`) and an unset `isDevelopmentStore` (nullable) must both still serve — so
the gate cannot regress into hiding live merchants. Removing the gate fails exactly 2 tests.

---

## 4. `canUseAdvancedEmailStudio` — audited, no defect

Flagged in an earlier session as "Pro-only in the plan table but never enforced". Investigated
from the plan definitions, the declaring comment, the billing copy and the code. **It is a
documented vestige, not an entitlement bypass.** No change made.

Evidence, three independent sources agreeing:

1. **Its own declaring comment** (`permissions.ts`): *"It was reserved for 'advanced' Email
   Studio (deeper layout/styling, extra templates). All of that now ships to every plan,
   including Free … see sanitizeEmailTemplateContentForPlan for the one remaining entitlement
   (showPoweredBy, which rides on canUseCustomBranding, not this flag)."*
2. **Billing copy** (`billing/plans.ts`): `"Email Studio — customize your review-request email"`
   is listed under the **Free** plan's feature list, not Pro.
3. **Zero enforcement references** outside `permissions.ts` — consistent with 1 and 2.

The *real* entitlement it points at **is** enforced server-side:

```ts
showPoweredBy: permissions.canUseCustomBranding ? content.showPoweredBy : true
```

`sanitizeEmailTemplateContentForPlan` is called at three points inside the Email Studio
**action** (test-email draft and both save paths), so a Free store cannot remove the
"Powered by" footer with a direct POST. Already covered by explicit tests, including
*"force-overwrites showPoweredBy to true for a Free store"*.

**Recommendation (your decision, not actioned):** leave the flag. Deleting it is cosmetic and
risks desyncing billing copy; it is correct as documented dead config.

---

## 5. Tenant isolation and authorization — audited, already correct

Reviewed and found sound, deliberately unchanged:

- Every coupon, appearance, product-group and review-request mutation performs
  `findFirst({ id, storeId })` and throws before writing. No unscoped write exists.
- `setProductGroup` verifies both the product **and** the target group belong to the caller.
- `appearanceService.setActive` checks `existing.storeId !== storeId` before activating.
- Every App Proxy route resolves its store from the signature-covered `shop` parameter, never
  from client-supplied body input.
- Public discovery API routes filter on `PUBLIC_STORE`.
- Token-gated feeds need no network gate — generating the token is itself the opt-in.

This is a read-based review of reachable paths. It is **not** a penetration test, and no live
cross-tenant request was attempted against production.

---

## 6. Test, typecheck, lint, build, Prisma

```
vitest run        1348 passed, 78 files
typecheck         0 errors    (react-router typegen && tsc --noEmit)
lint              0 problems  (eslint)
build             clean       (react-router build)
prisma validate   schema valid
prisma migrate    37 migrations found, database schema up to date
```

Production migration state, from both deploy logs: `37 migrations found in prisma/migrations`
/ `No pending migrations to apply`. **No migration executed.**

Each shipped fix was neutralised individually to confirm its tests are load-bearing:

| Fix | Tests failing when removed |
|---|---|
| reminder `remindersEnabledAt` gate | 6 |
| reminder plan entitlement | 4 |
| reminder suppression | 3 |
| bounce/complaint suppression | 3 |
| reward claim-before-Shopify | 2 |
| reward code generator (CSPRNG) | 2 |
| reward stale-claim recovery | 2 |
| reminder timing cutoffs | 2 |
| public-network consent gate | 2 |
| reward delivery-failure record | 1 |
| reminder null-email exclusion | 1 |

---

## 7. Shopify API-version warning — resolved

Verified by direct inspection of the Dev Dashboard. The warning is **absent** from the app
Overview, the Versions list and the version detail page; full page text of each was pulled and
contains no "Outdated" or API-version warning.

Active released version `imagyn-reviews-102` (Oct 27, 2026):

```
Webhooks api_version              2026-07
Privacy compliance api_version    2026-07
UI extensions        1  customer-reviews-admin-block  (toml: 2026-10)
Theme extensions     1  imagyn-review-widgets
Flow triggers        1  review-created
Metafields/metaobjects api_version  unstable
```

Against Shopify's published lifecycle table: **2026-10** is Latest stable; **2026-07** is
Stable until **2027-07-16**. Neither is outdated. The original trigger was `2025-10`, which
became Unsupported on 2026-10-16 and was fixed in `-102`.

**No Admin API bump and no SDK migration performed, correctly.** The installed SDK's
`ApiVersion` enum tops out at `2026-07` (verified at runtime) and
`@shopify/shopify-app-react-router` is on `^1.2.1` against npm latest `4.0.0` — a three-major
migration with no supporting evidence of necessity.

The `unstable` value on the metafields/metaobjects block is **not** a misconfiguration: Shopify
publishes no TOML key for that section's `api_version`, and every official template omits it.

**No extension deployment was performed this session.** Backend and extension deployments were
kept separate throughout.

---

## 8. Resend and Railway — verified, nothing rotated

Configuration confirmed present and consumed; **no secret value is recorded here or was printed
during the session**.

- `RESEND_API_KEY` present on the `imagyn-reviews` service, key-shaped (`re_…`, 36 chars).
- `RESEND_FROM_EMAIL` = `Imagyn Reviews <reviews@imagyn.co>`.
- `RESEND_WEBHOOK_SECRET` present.
- **No hardcoded key** in any tracked file or anywhere in git history. The single regex hit was
  a false positive — the Prisma index name `Store_googleFeedToken_key` contains `re_goo…`.
- `.env` and `.claude/settings.local.json` both confirmed gitignored.

PostgreSQL:

- **No `RAILWAY_TCP_PROXY_DOMAIN` / `RAILWAY_TCP_PROXY_PORT`** on the Postgres service — the
  public TCP proxy is disabled.
- `PGHOST` / `RAILWAY_PRIVATE_DOMAIN` = `postgres.railway.internal` (private).
- App connectivity healthy; migrations read cleanly on every boot.

> A probe of a `*.proxy.rlwy.net` host returned a PostgreSQL handshake. That is a **shared**
> Railway edge fleet and, with no proxy configured on this service, is not attributable to
> IMAGYN. Probing was stopped there deliberately rather than authenticating against what may be
> another tenant's database.

**No rotation performed** — there is no evidence of compromise or credential failure.

---

## 9. Competitor research — refreshed

A full 11-row sourced matrix already exists in
[`EMAIL_EXPERIENCE_AUDIT.md`](./EMAIL_EXPERIENCE_AUDIT.md) (2026-10-19) and was **not**
duplicated. Current public documentation adds these deltas:

| Competitor capability (verified, Oct 2026) | IMAGYN today | Priority |
|---|---|---|
| **Judge.me: up to 3 reminders per order**, delay 1–10 days *or* 12–24 hours | 2 reminders, whole days only | **Medium** — hour-granularity is the cheaper half; a 3rd reminder risks fatigue |
| **Judge.me: "only remind customers who didn't open the initial request"** | Not available | **High** — directly reduces unwanted mail, and open state already arrives via `email.opened` |
| Judge.me: review links valid 180 days | `requestToken`, no documented expiry | **Low** — verify intent before changing |
| Judge.me: per-product request templates (Sept 2026) | One template per type | **Low** — large feature, no evidence of demand |
| **Loox: up to 5 photos or 1 video per review** | Photo + video supported | **Low** — confirm the per-review cap matches |
| **Loox: discount specifically for photo/video reviews** | `requirePhoto` / `requireVideo` in reward eligibility | **None** — already comparable |
| Loox: global banner toggle across all emails | Shared branding exists (logo, colours) | **Low** |

**Top recommendation:** the "don't remind people who never opened the first email" option is
the highest value-per-effort item. `email.opened` is already handled by `webhooks.resend.tsx`
and already flips request status, so the signal exists; it needs a store setting and one extra
predicate in the reminder sweep's candidate query.

Competitors are used as functional benchmarks only. No competitor copy, assets, markup or brand
identity is reproduced.

Sources: [Judge.me reminders](https://judge.me/help/en/articles/11792628-automatic-review-request-reminder-emails),
[Judge.me request settings](https://help.judge.me/en/articles/8379844-configuring-review-request-settings),
[Loox email appearance](https://help.loox.io/article/45-what-are-review-request-emails),
[Loox video reviews](https://help.loox.io/support/solutions/articles/501000162441-video-reviews).

---

## 10. Email Studio — inspected, not rebuilt

All five requested capabilities already exist in the 1,864-line route, so no redesign was
started:

| Capability | Evidence |
|---|---|
| Persistent live preview | `iframe` / `srcDoc` |
| Four template types | `review_request`, `reminder_1`, `reminder_final`, `reward` |
| Desktop/mobile preview | viewport toggle present |
| Save-state tracking | `ContextualSaveBar` + dirty tracking |
| Safe test-email controls | `testEmail.server.ts`, caller-supplied recipient, draft rendering |

Plus `shouldRevalidate` and six existing test files. Test-email sends go to an explicitly
supplied address and cannot enqueue a customer campaign — they do not touch `ReviewRequest`
rows or the scheduler.

Judging visual quality requires the embedded Shopify admin, which is not reachable unattended.
**No concrete defect was found, so nothing was changed.**

---

## 11. Blocked — exact action needed

**End-to-end email delivery verification.** Nothing has been sent.

To unblock, reply with:

1. A **test recipient address** you control (e.g. `bilal+imagyn-test@…`).
2. Confirmation that **`verveonline.myshopify.com`** is the test store, or name another.
3. One line of authorization: *"authorized: send test emails to `<address>` on `<store>` only."*

Planned sequence once authorized — seed a test request on the test store → Day-0 send → confirm
Resend acceptance and the returned message id → confirm `email.delivered` webhook flips status →
advance reminder eligibility **in test data only** → confirm suppression on a simulated bounce.
No production row is read or written at any step.

---

## 12. Residual risks, unresolved

- **No CI.** Every green gate is a local run; nothing re-verifies on GitHub and nothing gates a
  merge.
- **Suppression casing gap.** `EmailSuppression` normalises to lower case; `ReviewRequest.email`
  is only trimmed. A differently-cased address survives the SQL `notIn` and is caught by the JS
  backstop instead, so it still occupies a batch slot. 25 would be needed to starve a batch.
- **Reward retention window.** Past Resend's 24-hour idempotency-key retention, a recovered
  crash can send a second reward email. Documented and pinned by a `RESIDUAL RISK` test.
- **`publicNetworkEnabled = false` has no live example** — covered by unit tests only.
- **Zero email traffic.** Every scheduler fix is preventive; no live send has exercised them.
