# Imagyn Reviews — Night Shift Handover

**Written:** 2026-11-06
**Covers:** the night-shift session of 2026-11-05/06
**Scope:** Imagyn Reviews only. The Imagyn Studios agency website is a separate project and is
not touched anywhere in this document.

> This file replaces an earlier handover of the same name. The previous version is preserved in
> git history at commit `d30409e`.

---

## 1. Bottom line

Three bodies of work landed and are pushed: the design system is real and adopted across every
merchant screen, Email Studio is complete and verified end to end, and four Judge.me parity
gaps are closed.

**Not deployed. Nothing has been released, merged or pointed at a production database.** The
deployment checklist in §8 is prepared and waiting on your approval, and §9 lists the risks I
would want answered before you give it.

| | |
|---|---|
| Branch | `main`, in sync with `origin/main` |
| HEAD | `40a5851` |
| Session commits | 3, all pushed |
| Diff vs session start (`79537b6`) | 100 files, +10,112 / −923 |
| Tests | **1,714 passing, 89 files** (from 1,493 / 82) |
| Typecheck · lint · build | Clean |
| Database | **Untouched.** No migration applied, no schema change, no write of any kind |
| `Brand Assets/` | Untouched |

---

## 2. What was completed

### 2.1 Design system — real, and adopted

`app/styles/design-system.css` is the source of truth.
`docs/IMAGYN_DASHBOARD_DESIGN_SYSTEM.md` explains it.

**The brand green is in the product.** `#5C9754` previously existed only in a handover
document while the code shipped a chartreuse `#97a819` that read as highlighter-yellow. It is
now a three-value family whose jobs are not interchangeable:

| Token | Value | Job | Contrast on white |
|---|---|---|---|
| `--color-brand` | `#5c9754` | Fills and non-text marks **only** | 3.49:1 — clears AA for UI components, **not** for text |
| `--color-brand-strong` | `#3d6b36` | Text and icons | 6.26:1 |
| `--color-brand-soft` | `#e8f1e6` | Pale tint behind `--color-text` | — |
| `--color-brand-border` | `#c3dcbd` | Hairline on a brand-tinted surface | — |

The old `--color-highlight*` names remain as aliases, which is how the swap reached all 19
existing declarations across seven route stylesheets without editing one of them.

**Geist Sans is self-hosted and live.** `scripts/copy-fonts.mjs` copies two variable `woff2`
files out of the `geist` package into `public/fonts/` on `prebuild` and `predev` — generated
and gitignored, the same arrangement `public/appearance-preview/` already used. Preloaded in
`root.tsx` with `crossOrigin`, `font-display: swap`, Helvetica next in the stack. Verified
present in the client build at `build/client/fonts/`. Also added: `--font-mono`, `--text-4xl`,
and the weight / tracking / leading scales.

**Five primitives, extracted from patterns that already existed and then actually adopted** —
none of this is dead code:

| Primitive | Replaced | Now used by |
|---|---|---|
| `Table` | Three hand-rolled tables (Reviews, Requests) + Polaris `DataTable` (Products) | Reviews, Requests, Products |
| `Metric` / `MetricRow` | `app._index`'s `.kpiCard`/`.kpiHero` + `app.management`'s `.statRow`/`.stat` | Dashboard, Settings → Trust, Settings → Rewards |
| `Stack` | Polaris `BlockStack` | 5 screens + `ReviewForm` |
| `Text` | Polaris `Text` | 4 screens + `ReviewForm` |
| `StatusBadge` (extended) | **Six** separate Polaris `Badge` wrappers | Every screen that shows a status |

`Banner` absorbed the Polaris `<Banner>` from six screens. `Card` and `EmptyState` replaced
their Polaris equivalents. Roughly 200 lines of now-dead route CSS were deleted rather than
left behind.

**Polaris itself is token-aligned.** About a dozen screens still use Polaris form controls —
they are accessible, they handle labels, errors and keyboard behaviour correctly, and
hand-replacing forty of them would be a large change with real regression risk for a purely
visual gain. Re-pointing Polaris's own tokens at the Imagyn palette achieved the same result
for all of those screens at once with **no behavioural change**: surfaces, type, borders, the
brand fill, and the focus ring — which was Shopify blue, the only blue anywhere in this
interface.

Nothing in that alignment lowers a contrast ratio. The focus ring went from 4.6:1 to 17.7:1,
body text from 12.6:1 to 17.7:1, and the input border holds at 3.4:1 via a new
`--color-border-control`. That token exists because `--color-border` (1.3:1) and
`--color-border-strong` (1.58:1) are both right for a divider and both wrong for the edge of a
text input, which is the only thing telling someone where to type — WCAG 1.4.11 wants 3:1
there.

**Three badge tone corrections**, each a semantic fix rather than a restyle:

| | Was | Now | Why |
|---|---|---|---|
| Review `REJECTED` | `attention` (amber) | `danger` | A terminal negative outcome, not a "look at this" |
| Request `failed` | `attention` | `danger` | A failed send needs acting on |
| Request `cancelled` | `attention` | `neutral` | Cancelling is the merchant's own deliberate stop; amber put a warning colour on their decision |

### 2.2 Email Studio — complete and verified

Everything the brief asked for is present and working:

| Requirement | State |
|---|---|
| Prebuilt templates | **Five** — Minimal, Modern, Editorial, Classic, Product Showcase |
| Working editor | Copy, colour, type, spacing, layout, sections, logos, custom HTML |
| Live preview | Debounced, server-rendered, uses the real renderer |
| Desktop / mobile preview | Both, plus a light/dark palette toggle |
| Merchant branding | Three-tier logo precedence; sender identity; reply-to |
| Persistence | Per store, per template type; reset is a real delete |
| Test send | Real provider, real sender identity |

The template library is expressed **entirely in the existing `EmailTemplateContent`
contract** — no second content model, no parallel renderer, no new column. A preset changes
presentation only and never touches the merchant's subject, copy, logo, display name,
reply-to or custom HTML. Two narrow exceptions, both additive and both enforced in
`applyEmailTemplatePreset` rather than trusted to each preset definition: it may set
`showProduct` true but never false, and it may reorder sections but never add, remove, enable
or disable one. Only Product Showcase uses either.

`app/services/notifications/emailStudio.e2e.test.ts` walks the whole merchant path with no
mocks — pick a style → draft → save (normalize + plan-sanitize) → `buildReviewRequestEmail`,
**the same renderer the real send uses** → rendered HTML and text. That shared renderer is
what makes "it looked right in the preview" a meaningful statement.

### 2.3 Judge.me parity — four gaps closed

| Gap | Audit effort | State |
|---|---|---|
| Prebuilt template library | — | **Done** |
| In-email star rating | 3 | **Done** |
| AI reply tone selector | 1 | **Done** (tone; the 500/day cap is not implemented — Imagyn has no per-store AI quota at all yet) |
| Title auto-fill from body | 0.5 | **Done** |

**One-tap star rating.** Five tappable stars above the CTA in the request and both reminders.

Every star links to the **identical** form; only the pre-selected rating differs, nothing is
recorded by tapping, and a one-star tap lands exactly where a five-star tap does. Routing low
ratings anywhere else is review gating — a Shopify App Store violation and an FTC problem, and
it is the **app** that gets delisted, not the merchant. Asserted on rendered HTML, not just on
the URL helper. `validateEmailStarsPrompt` additionally rejects gating copy ("Leave us 5
stars!") at the save boundary.

Drawn with the ★ glyph rather than five images, directly because of this project's own Apple
Mail finding: remote images are blocked by default on first open, and an image star row
degrades to five broken-image icons.

Rollout is asymmetric, per your approved direction: **a store with no saved template (every
new install) gets the row on; a store with a saved template keeps the email it already had.**
`SECTIONS_ADDED_AFTER_LAUNCH` is the migration record that makes that true. It back-fills the
row above the CTA rather than appending it after the sign-off — otherwise a merchant who later
switched it on would find five stars under their closing line. 45 tests cover new installs,
saved rows, rows predating the `sections` field entirely, re-enabling, disabling, and all five
ratings.

**AI reply tone.** Friendly, Direct, Elegant, as a closed enum because the value reaches a
system prompt and a free-text style field would be a prompt-injection surface on
merchant-editable input. "friendly" is the default and reproduces the previous prompt **byte
for byte**. Every honesty rule (answer what they actually said, acknowledge a real problem,
never invent a fact or a resolution) is shared across all three voices and asserted per voice.

### 2.4 Defects found and fixed along the way

Each of these was found by writing a test or by converting a screen, not by reading code:

1. **`undefined` in a system prompt.** An unrecognised AI reply tone spliced the literal
   string `undefined` into the prompt. Unreachable through the route, which validates first,
   but fixed with an explicit fallback.
2. **Star row appended after the sign-off.** Back-filling by appending put five stars below
   the closing line for every existing merchant. Invisible while off, visibly wrong the moment
   one switched it on — which is the exact case the back-fill serves.
3. **A no-op control.** The reward template's star-row toggle could be switched on and did
   nothing, because that template never renders a star row. Now disabled and labelled "Not
   sent".
4. **Responsive columns silently broken.** Converting Requests to the shared table dropped
   four `hideOnNarrow` columns' CSS. Worse, the general version of that bug hides a column's
   cells but not its header, which misaligns every remaining column in a fixed-layout table.
   Fixed in the primitive so no screen can reintroduce it.
5. **Inline widths cannot be overridden by a media query.** A narrow frame had no way to
   reallocate the space freed by a dropped column. Widths now travel as custom properties.
6. **A false claim in my own comment.** The headline regex claimed to protect abbreviations
   and did not — "Runs small, i.e. order a size up" produced the headline "Runs small, i.e".
   Fixed so the claim is true, and both protections are pinned by name in tests.
7. **`<p>` inside `<p>`.** Several converted Banner call sites pass their own paragraphs;
   browsers silently restructure that, which breaks the styling. Body now renders in a `<div>`.
8. **A missing CSS class rendering visible text.** `styles.visuallyHidden` did not exist in
   the Requests stylesheet, so the "Actions" column header would have rendered visibly.
   Replaced with a real `headerHidden` option on the table.
9. **Banners were silent to assistive technology.** Tones that describe a problem now carry
   `role="alert"` / `role="status"`, so a merchant whose form just failed is told why.

---

## 3. Test results

```
Test Files  89 passed (89)
Tests       1714 passed (1714)
```

Typecheck clean. Lint clean. Production build succeeds (`✓ built in ~1.1s`), with the Geist
font files landing at `build/client/fonts/`.

New coverage added this session:

| Suite | Tests | What it holds |
|---|---|---|
| `emailStarRollout.test.ts` | 45 | New installs vs existing stores, all five ratings |
| `starRating.render.test.ts` | 52 | Every star goes to one form; glyph not images |
| `emailTemplatePresets.test.ts` | 30 | Mostly what a preset does **not** touch |
| `emailStudio.e2e.test.ts` | 24 | Pick style → save → the renderer the real send uses |
| `replyTone.test.ts` | 25 | The prompt boundary; honesty rules per voice |
| `reviewTitleSuggestion.test.ts` | 23 | When it declines to guess |
| `Table.test.tsx` | 22 | Selection, master-detail, responsive columns, a11y |

`vitest.config.ts` now includes `*.test.tsx`, so a shared UI primitive can be tested at all.
Component tests render to static markup with `react-dom/server` and need no DOM.

---

## 4. Git status

```
main  40a5851  (= origin/main)

40a5851  feat: headline suggestion, and Email Studio verified end to end
74ae914  refactor(ui): one visual language across every merchant screen
d30409e  feat: design system, Email Studio template library, one-tap star rating
```

Working tree is clean except three paths left untracked **deliberately**:

| Path | Why it is untracked |
|---|---|
| `Brand Assets/` | 3.3 MB of binary design source, pre-existing, referenced by no code. Committing binaries is your call. **Awaiting your answer.** |
| `skills-lock.json` | Lockfile for a vendored AI-tooling skill bundle. `.gitignore` already excludes `.claude/` and `.agents/` as "local AI-agent tooling — never project source"; this is the same category. |
| `.github/workflows/ci.yml` | **Blocked, see §7.** |

No `.env`, secret, credential, customer record, database dump or temp file is committed. Every
changed path and the staged diff were scanned for Resend / OpenAI / Shopify / AWS token shapes,
private keys and credentialed Postgres URLs before each commit. The only match is the CI
workflow's documented placeholder `postgresql://ci:ci@127.0.0.1:5432/ci_never_connected`,
which is never dialled.

---

## 5. Remaining work

### 5.1 Judge.me parity still open

Everything below needs a **schema migration**, which needs your approval (see §7).

| Gap | Effort | Note |
|---|---|---|
| Quick star-only ratings | 1 | Content is currently required. Needs a per-store toggle, so a merchant who wants written reviews is not suddenly receiving empty ones. The feature is designed; the column is not written. |
| Third reminder | 3 | Judge.me allows up to 3; Imagyn has 2 |
| Anonymous reviews | 1 | Judge.me early access |
| Store review prompt after a product review | 2 | |
| Prompt for other products in the order | 2 | |
| YouTube link reviews | 2 | |
| AI reply daily cap | 1 | No per-store AI quota exists at all yet |
| Review translations | 6 | |
| Custom review questions | 8 | No model |
| Product Q&A | 8 | No model |

### 5.2 Widgets still missing

Testimonials Carousel, Review Snippets, Happy Customers, Pop-up Reviews, UGC Instagram, and a
storefront Referrals widget. See `docs/JUDGEME_PARITY_AUDIT.md` §3 for the full inventory with
plan tiers.

### 5.3 UI work genuinely remaining

The merchant UI is now one visual language. What is left is deliberate, not unfinished:

- **Polaris form controls** on about a dozen settings screens. Token-aligned, accessible, and
  kept on purpose. Replacing them is a large, risky change for a visual gain already achieved.
- **Polaris `Modal`, `Popover`, `ActionList`, `Icon`, Skeletons.** Each exists on at most one
  or two screens; extracting house versions would be abstraction over one caller.
- **The Shopify-orders picker** in the Send Request modal still renders its own table. It
  needs per-row checkbox disabling (an order with an existing request is not selectable) and
  keeps its header while showing a body message. Teaching the shared table both for one caller
  would make it worse for the two queues using it.
- `app.reviews.module.css` is still the largest stylesheet at ~965 lines; most of it is the
  detail panel, which has no second caller.

---

## 6. Production readiness review

### 6.1 Database and migrations

| Check | Result |
|---|---|
| Migrations on disk | **39** |
| `prisma migrate status` (local dev) | "Database schema is up to date!" |
| `prisma validate` | Schema valid |
| Schema ↔ migration coverage | All 82 `Store` fields accounted for; the 21 with no SQL are Prisma **relation** fields, which never become columns |
| Destructive SQL anywhere | **One** migration, `20260915110515_rescope_ai_summary_display_flags` |

That one migration is correctly ordered — add new columns, **backfill from the old column's
real per-row value**, then drop. It dates from 2026-09-15 and is long applied. Nothing in this
session's work requires a migration at all.

**Local dev database confirmed as `localhost:5432/imagyn_reviews_dev`.** Not Railway.

### 6.2 Environment variables

The code reads 22 variables. `.env.example` documents 20.

| Variable | Required in production | Documented in `.env.example` |
|---|---|---|
| `DATABASE_URL` | Yes | Yes |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Yes | Yes |
| `SHOPIFY_APP_URL` | **Yes** — used to build every review link | Yes |
| `SCOPES` | Yes | Yes |
| `RESEND_API_KEY` | Yes | Yes |
| `RESEND_FROM_EMAIL` | Yes | Yes |
| `RESEND_WEBHOOK_SECRET` | **Yes** — bounce/complaint suppression | Yes |
| `EMAIL_PROVIDER` | No — defaults to `resend` | Yes |
| `STORAGE_PROVIDER`, `AI_PROVIDER`, model vars | No — have defaults | Yes |
| `APP_URL` | No — a fallback for `SHOPIFY_APP_URL` | **No — gap** |
| `AI_SUMMARY_REGENERATION_THRESHOLD` | No | Yes |

**Two findings.** `APP_URL` is read by `review-request.server.ts` as a fallback but is not in
`.env.example`. And `RESEND_WEBHOOK_SECRET` is **unset locally** — fine for development, and
the handler fails **closed** (logs and returns 500 rather than accepting unverified
webhooks), which is the correct posture. It must be set in production or bounce and complaint
suppression silently stops working.

### 6.3 Shopify integration

| Item | State |
|---|---|
| `application_url` | `https://app.imagyn.co` |
| App proxy | `/apps/reviews` → `https://app.imagyn.co/api/reviews` |
| Webhook API version | `2026-07`, deliberately matched to the SDK's `ApiVersion.July26` |
| GDPR compliance webhooks | All three present on one subscription, as Shopify requires |
| Other webhooks | `app/scopes_update`, `app/uninstalled`, `app_subscriptions/update`, `fulfillments/create` |
| Protected Customer Data | Approved 2026-09-08 |
| Order automation | `ORDER_AUTOMATION_ENABLED = true`, with a defence-in-depth flag check inside the webhook handler |
| Proxy endpoint auth | 10 routes, all using `authenticate.public.appProxy` |

### 6.4 Resend

| Item | State |
|---|---|
| API key | Present, `re_` prefix, send-only |
| From domain | `notifications.imagyn.co` |
| DKIM | Present on `notifications.imagyn.co` and `imagyn.co` |
| SPF | Correct on `send.notifications.imagyn.co` (`include:amazonses.com`) |
| DMARC | `p=none` — present but unenforced |
| Webhook | Verifies Svix signature with a timestamp tolerance; fails closed |
| Live delivery | Five real messages accepted; both flows; both Reply-To rules confirmed |
| Inbox placement | **Not verified.** See `docs/EMAIL_DELIVERABILITY_FINDINGS.md` |

### 6.5 Storefront

11 theme app extension blocks, 41 asset files, 10 proxy-authenticated API routes. Untouched
this session — no storefront change was made, so no storefront regression is possible from
this work.

---

## 7. Blockers

Each of these genuinely needs you. None of them blocked anything else; I continued past all
three.

1. **CI workflow cannot be pushed.** GitHub rejects it: *"refusing to allow an OAuth App to
   create or update workflow `.github/workflows/ci.yml` without `workflow` scope."* Neither
   authenticated account (`bilalzaib2`, `purenutritionpk`) has that scope. The file is written,
   working and intact on disk; it is held out of all three commits so the rest could be
   secured. To finish: run `gh auth refresh -h github.com -s workflow`, then commit and push
   that file alone.

2. **Any further parity work needs a migration.** Store settings are real columns, not a JSON
   blob, so the star-only toggle, the third reminder and anonymous reviews each need
   `ALTER TABLE`. Per `CLAUDE.md` that needs your explicit approval every time, so I designed
   them and stopped rather than writing migrations you have not seen.

3. **Managed Pricing trial length is still unverified.** `partners.shopify.com` redirects to
   the public marketing page because that browser session is not authenticated. The billing
   page advertises a trial I cannot confirm.

Also outstanding, and not blockers: the Judge.me reference screenshots never arrived (I built
the design system from your written direction instead), and **Notion is not connected** to
this session — only an unauthenticated connector stub is available, so the parity tracker was
not updated. `docs/JUDGEME_PARITY_AUDIT.md` §3–4 is the live matrix and was updated in place.

---

## 8. Deployment checklist

**Do not run any of this without explicit approval.** It is written for you to review first.

### Before deploying

- [ ] **Decide the star-row rollout.** New installs get the one-tap star row **on**; stores
      with a saved template keep what they have. Confirm that is what you want, because it
      changes outgoing customer email for new stores on the first deploy.
- [ ] **Set `RESEND_WEBHOOK_SECRET` in Railway.** Without it the handler returns 500 and
      bounce/complaint suppression stops. Fails closed, so this is a silent loss of
      suppression, not a leak.
- [ ] **Confirm `SHOPIFY_APP_URL` is set in Railway.** Every review link in every email is
      built from it. A wrong value produces dead links in customer inboxes.
- [ ] Add `APP_URL` to `.env.example` (documentation gap, not a runtime one).
- [ ] **Back up the production database** and verify the dump completes — not just that the
      command exited.
- [ ] Push the CI workflow (§7.1) so `main` is actually gated.
- [ ] Decide on `Brand Assets/` and `skills-lock.json` (§4).
- [ ] Re-run all four gates on the exact commit being deployed.

### Deploying

- [ ] `npm run build` must succeed on the deploy host, and `prebuild` must run — otherwise
      `public/fonts/` is absent and every screen silently falls back to Helvetica.
- [ ] **No migration is needed for this release.** `prisma migrate deploy` has nothing to
      apply. If it reports pending migrations, stop and investigate before proceeding.
- [ ] `shopify app deploy` only if the extension or `shopify.app.toml` changed. **Neither did
      this session**, so this step is very likely unnecessary.

### After deploying

- [ ] Open each merchant screen once and confirm Geist is loading (not Helvetica) and the
      green is the sage `#5c9754`, not chartreuse.
- [ ] Send one test email from Email Studio to the authorised inbox and tap a star — confirm
      the landing page opens with that rating pre-selected.
- [ ] Confirm one existing store's saved template did **not** gain a star row.
- [ ] Watch the Resend webhook log for signature failures.
- [ ] Check the storefront widgets on one real product page.

### Rollback

`git revert` any of the three commits independently — they are ordered so the UI refactor
(`74ae914`) can be reverted without touching the email work (`d30409e`). No migration ran, so
**there is no database rollback to perform**, which is the single biggest thing in this
release's favour.

---

## 9. Risks

Ranked by what I would actually worry about.

| # | Risk | Severity | Mitigation / state |
|---|---|---|---|
| 1 | **No UI has been seen rendered.** Every visual change is verified by tests, contrast arithmetic and code reading — I could not open the embedded app. The Polaris token alignment in particular touches a dozen screens at once. | **High** | Revert `74ae914` independently. Budget time to click through every screen before announcing the release. |
| 2 | **`RESEND_WEBHOOK_SECRET` missing in production** would silently stop bounce and complaint suppression, which degrades sending reputation over days. | High | One env var. On the checklist. |
| 3 | **Inbox placement is still unverified.** Earlier test mail landed in Junk. Authentication is **not** the cause (DKIM, SPF and the return-path MX are all correct); the causes are zero sending reputation, a spam-shaped test From, and `p=none`. | Medium | Raise DMARC to `p=quarantine` after a few days of clean sending; mark the earlier messages "not junk". Do not record as fixed. |
| 4 | **Star row changes customer email for new installs.** Deliberate and approved, but it is live customer-facing copy. | Medium | Per-template toggle; existing stores unaffected; 45 tests. |
| 5 | **Managed Pricing trial unverified** while the billing page advertises it. | Medium | Needs a Partner Dashboard login. |
| 6 | **`prebuild` not running on the deploy host** would ship the app with no font files and a silent Helvetica fallback. | Low | `font-display: swap` means it degrades to the documented fallback, never to invisible text. On the checklist. |
| 7 | **Geist licence.** Self-hosted from the `geist` npm package (SIL Open Font License). Worth a glance before a public launch. | Low | Licence file ships in `node_modules/geist/LICENSE.txt`. |
| 8 | **House inputs may not meet WCAG 1.4.11.** The new `--color-border-control` fixed the Polaris inputs at 3.4:1, but the app's own hand-rolled inputs still use `--color-border` (1.3:1). | Low | Pre-existing, not introduced here. Worth a follow-up pass. |
| 9 | **`main` is unprotected and ungated** until the CI workflow lands. | Low | §7.1. |

---

## 9a. SESSION OF 2026-11-06 (second) — completed work

Five commits, all pushed. Gates green after each one. **No migration, no database write, no
deployment.**

```
f650364  style: readable headings, one typeface, and green used deliberately
68b7ea0  feat(reviews): workspace navigation, and drop the repeated eyebrow label
d9c7334  feat(reviews): full-width review table, detail moves to a drawer
6278e8c  feat(coupons): surface issued codes, and confirm the irreversible action
09db694  fix: rewards must never depend on a review's star rating
a2435ad  docs: resume point after reaching the usage limit during state recovery
```

**Tests: 1,762 passing across 90 files** (from 1,714 / 89). Typecheck, lint, production build
and `prisma validate` all clean.

### The compliance defect — read this one first

**Review Rewards gated issuance on a minimum star rating.** A merchant could set "4" and only
4- and 5-star reviews earned a discount.

That is paying for positive reviews. It is prohibited by the FTC's rule on consumer reviews
and testimonials (16 CFR Part 465, in force since 2024) and breaches Shopify's App Store
requirements on review integrity — and **the liability falls on the app, not the merchant.**
Imagyn is what gets delisted.

Found by researching the benchmark rather than by reading our own code: Judge.me removed
rating-based coupon rules from its own product for exactly this reason and says so in their
help centre. We had kept ours.

The condition is **gone**, not relaxed. `evaluateEligibility` does not read a rating at all,
`getRewardSettings` no longer selects the column, `RewardSettings` no longer carries the
field, and the merchant-facing control is replaced by a Banner explaining why. Every remaining
condition is about the review's *form* — verified purchase, photo, video — never its opinion,
which is the distinction the FTC rule draws.

`Store.rewardMinRating` is retired in place rather than dropped (a column needs a migration;
a stored value is now inert) and carries a `///` doc comment saying so. Two tests that asserted
the old behaviour are **inverted** rather than deleted, so the rule cannot quietly return.

### Judge.me coupon research — findings

Sources: Judge.me help centre articles on generated coupon codes and custom discount codes.

| Judge.me | Imagyn | Verdict |
|---|---|---|
| One coupon per review; adding media later does not upgrade it | `Reward.reviewId` is `@unique` | **Matches** |
| Minimum order value / minimum item quantity | `Coupon.minimumOrderAmount` | Matches for coupons |
| Usage limit, expiry | `usageLimit`, `endsAt` | **Imagyn ahead** (no expiry found in Judge.me's docs) |
| Coupons are a paid-plan feature | Free in Imagyn | Deliberate differentiator |
| **Cannot vary by star rating** (removed for Shopify policy) | We did | **Fixed, see above** |
| **30-minute delay** after a review, so the customer can add media first | Issues immediately on approval | **REAL GAP** — and it bites: a `requirePhoto` condition is evaluated at approval, so a customer who adds a photo two minutes later gets nothing |
| **Tiered rewards by content** — text gets X, photo gets Y, video gets Z | Single value; photo/video are *gates*, not tiers | **REAL GAP** — needs two columns |
| Eligibility: any / verified buyer / verified buyer of the reviewed product / came via a review request | `requireVerified` only | **GAP** |
| Combines with product or shipping discounts | Not set | **GAP** |
| Static code, or a list of single-use codes, instead of generated | Not supported | Gap, lower value |
| Free shipping as a reward type | Not supported | **Not a Judge.me coupon feature either** — the one source claiming it describes a third-party loyalty app |

**The coupon integration itself was already sound** — this is the thing not to rebuild.
`shopifyDiscount.server.ts` already calls the real `discountCodeBasicCreate`,
`discountCodeDeactivate`, `discountCodeActivate` and `asyncUsageCount`, and `Reward`/`Coupon`/
`CouponRedemption` already model discount type, eligibility, minimum order, dates and limits.
The gap was UX and reporting.

### What was built

**Coupons.** `listRedemptions` had existed and been tested all along and the page never called
it, so a merchant could issue a personalised code and then had no record of who received one or
whether Shopify accepted it. Each campaign now shows its issued codes — customer, code, status,
date — in the shared `Table`, collapsed behind a `<details>` so a campaign with 200 codes does
not bury the others. "End" is now confirmed: it deactivates the real Shopify discount with no
path back, and sat one click from Pause, which *is* reversible. Errors render as Banners (with
`role="alert"`) rather than muted grey paragraphs.

**Review Management, full-width.** It was a two-column grid — a ~62% list beside a permanently
mounted ~38% detail panel — so the table gave up a third of the admin's width even while the
merchant was only scanning. The list is now full width and the detail is a right-hand drawer.

Six columns instead of four: Customer (with the verified-buyer indicator beside the person
rather than buried in the review text), Rating, Review, Product, Status, Date. The review cell
gained a two-line clamped body preview, which the old layout had no room for at all. Customer
and Product carry `hideOnNarrow`; Rating, Review and Status always survive.

The drawer has three ways out — scrim, always-visible close, Escape — because an overlay with
one is an overlay a merchant gets stuck in. The scrim is a real `<button>` with an accessible
name. On a phone, selecting a review no longer hides the list: it used to have to, because the
panel was a flowing column.

**Workspace navigation.** Reviews and Review Requests now carry a shared tab row — real
anchors (App Bridge owns navigation in an embedded app; a `<Link>` never updates the URL),
active state derived from the pathname. Styled as an underline on a hairline, not pills, which
read as a filter rather than navigation.

**Typography and green.** 49 `text-transform: uppercase` rules had accumulated — 12px,
0.1–0.16em tracking, muted grey, above every card. 20 selectors across 18 stylesheets are
retypeset to real readable labels; uppercase survives only on badges and table column headers,
where it has a purpose. The repeated "Imagyn Reviews" eyebrow above every page title is gone
from seven routes and from `PageHeader`'s default.

Typeface: **Geist Sans alone**, with the reasoning for rejecting Montserrat, Inter, Manrope and
Helvetica Neue written up in the design-system doc §3.1a, plus the one-token path to
display-only Montserrat if you want it. Page title is now 700 at -0.035em; section headings are
a real 18px/600 heading.

Green: **one gradient, in one place** — `Metric`'s hero variant on the Dashboard, 5%→1.5% over
white, and a tone always wins over it. Where green is and is not allowed is written down
(§3.1c).

### Blocked, and why — all documented rather than worked around

1. **Every remaining parity gap needs a migration.** Store settings are real columns, not a
   JSON blob, so tiered rewards, the 30-minute delay, richer eligibility, star-only reviews,
   a third reminder and anonymous reviews each need `ALTER TABLE`. Per `CLAUDE.md` that is
   explicit approval, every time. Designed, not written.
2. **`shop.brand.colors` is unverified.** `app/services/ai/types.ts` carries a comment claiming
   Shopify's Admin API exposes no brand colour — but we successfully query `shop.brand.logo`, so
   that comment is at least partly wrong and the Storefront API definitely has `BrandColors`.
   The Shopify MCP connector **disconnected mid-session** and the docs pages 404 to WebFetch, so
   this could not be settled. It gates the "use merchant brand colours" half of both the Email
   Studio and Brand Studio default-branding briefs. Verify it first next session.
3. **No UI has been seen rendered.** Still the top risk. §5 of the brief asks for Chrome
   inspection against a development store; not available from here.
4. **Product Q&A, Spam, Archive, Product-vs-Store review categories have no data model.**
   Deliberately absent from the new navigation rather than shipped as dead tabs.
5. **CI workflow still unpushable** without `workflow` scope (§7.1).

### The exact next task

**Verify whether `shop.brand.colors` exists in the Admin API** (reconnect the Shopify MCP, or
introspect against the development store). It unblocks the largest remaining brief — automatic
brand colours for Email Studio §2A and Brand Studio §4A — and is a five-minute check.

If it does not exist, go straight to **requesting approval for one migration** covering the
tiered-reward columns and the reward delay, which are the two highest-value coupon gaps the
research found.

## 10. Next steps, in the order I would take them

1. **Click through every merchant screen** and confirm the visual work. This is the single
   highest-value thing, and it is the one thing I could not do.
2. **Approve or correct the star-row rollout decision.**
3. **Set `RESEND_WEBHOOK_SECRET` and confirm `SHOPIFY_APP_URL`** in Railway.
4. **Grant `workflow` scope and push the CI file**, so `main` is gated before any release.
5. **Decide on `Brand Assets/`.**
6. Deploy, following §8, then work §8's post-deploy list.
7. **Then** pick up parity: approve a migration and I will build the star-only toggle and the
   third reminder, which are the two highest-value remaining gaps.
8. Verify the Managed Pricing trial length.
9. Raise DMARC to `p=quarantine` once a few days of clean sending have accumulated.

---

## 11. Where things live

| | |
|---|---|
| Design system | `app/styles/design-system.css`, `docs/IMAGYN_DASHBOARD_DESIGN_SYSTEM.md` |
| UI primitives | `app/components/ui/` |
| Email contract | `app/services/email.shared.ts` |
| Template library | `app/services/emailTemplatePresets.ts`, `app/components/email/TemplateGallery.tsx` |
| Email renderer | `app/services/notifications/emails/ReviewRequestEmail.tsx` |
| Entitlements | `app/services/permissions.ts` — the single source of truth, read as booleans |
| Parity matrix | `docs/JUDGEME_PARITY_AUDIT.md` §3–4 |
| Deliverability findings | `docs/EMAIL_DELIVERABILITY_FINDINGS.md` |
| Resend setup | `docs/RESEND_SENDER_SETUP.md` |
| Previous handover | `docs/IMAGYN_REVIEWS_SESSION_HANDOVER.md` §13 |
