# Imagyn Reviews — Judge.me Functional Parity Audit

**Date:** 2026-11-05
**Benchmark:** Judge.me Product Reviews (the Reviews product only — not Judge.me Email, Importer,
Reviews site, or Community, which are separate products)
**Repository:** `/Users/bilalzaib/Code/imagyn-reviews`, branch `main`, HEAD `79537b6`

This is the first deliverable: inventory, gap matrix, roadmap, risks, effort, testing
requirements, and a definition of parity. No implementation has started.

---

## 1. Method and evidence quality

Judge.me's product surface was read from its own sources, not from memory or third-party blogs:

| Source | Used for |
|---|---|
| Shopify App Store listing | Plan names, prices, trial length, per-plan feature bullets |
| `judge.me/help` widget overview | The complete widget table with plan tier and supported pages |
| `judge.me/help` review collection flow | Form layouts, fields, character limits, media limits |
| `judge.me/help` request scheduling / reminders | Reminder count and per-order-type timing |
| `judge.me/help` AI replies, translations | AI behaviour, tone options, daily caps |

Where a third-party source conflicted with Judge.me's own pages, Judge.me's pages win. Two
things could not be confirmed and are marked NOT VERIFIED throughout: the current SMS path
(the SMSBump integration is deprecated and no replacement is documented) and push
notifications (no Judge.me documentation found; the pricing page mentions them, the help
centre does not).

Imagyn status is from direct code inspection in this session. No feature is marked COMPLETE
because a UI element exists.

> **CORRECTION, 2026-11-05.** Later first-hand research of Judge.me's early-user-program page
> established that several features recorded below are **early access, not generally released**.
> The genuine parity gap is therefore narrower than this document first stated, and the roadmap
> in §7 over-sequences work on features Judge.me itself has not shipped. Affected rows are
> annotated inline. See `docs/JUDGEME_COMPETITIVE_RESEARCH.md` §3 for the full list and its
> consequences.

**Benchmark plan shape.** Judge.me is Free + Awesome at $15/month with a 15-day trial. Imagyn
is Free + Pro at $9.99/month with a 7-day trial. Imagyn is therefore priced at roughly
two-thirds of the benchmark, which matters to the gap analysis: several things Judge.me
charges for are already free in Imagyn, and that is a deliberate position worth keeping.

---

## 2. Verified Imagyn baseline

Re-run independently today, not inherited from the handover:

| Gate | Result | As of |
|---|---|---|
| Tests | **1609 passed, 86 files** | 2026-11-06 |
| Typecheck | Clean | 2026-11-06 |
| Lint | Clean | 2026-11-06 |
| Production build | Succeeds, zero errors | 2026-11-06 |
| Working tree | 72 modified/untracked paths, nothing committed | 2026-11-06 |

The 2026-11-06 figures supersede the 1431/81 baseline this section originally recorded. The
increase is real new coverage, not re-counted tests: the one-tap star rating (52), the Email
Studio template library (30), the AI reply voices (25), the `Table` primitive (9), plus the
earlier brand-logo and entitlement work.

The Night Shift work and the P0 entitlement fix are intact. `Brand Assets/` and all
pre-existing untracked scripts are untouched.

---

## 3. Judge.me widget inventory vs Imagyn

Judge.me's own table lists 18 widget entries (it markets "16 widgets"). Plan column is
Judge.me's.

| # | Judge.me widget | JM plan | Imagyn equivalent | Status |
|---|---|---|---|---|
| 1 | Review Widget | Free | `star_rating` block + `reviews-widget.js` | **COMPLETE** |
| 2 | Star Rating Badge | Free | `rating_badge` | **COMPLETE** |
| 3 | Cards Carousel | Free | `review_carousel` | **COMPLETE** |
| 4 | Testimonials Carousel | Free | — | **MISSING** |
| 5 | Videos Carousel | Free | `video_reviews_carousel` (Imagyn gates this to Pro) | **COMPLETE, gating differs** |
| 6 | Reviews Carousel (original) | Free | `review_carousel` | **COMPLETE** |
| 7 | Reviews Grid | Free | — (grid is a layout option, not a block) | **PARTIAL** |
| 8 | Floating Reviews Tab | Awesome | `floating_reviews` | **COMPLETE, unverified on storefront** |
| 9 | AI Reviews Summary | Awesome | `ai_review_summary`, `store_ai_summary` | **COMPLETE** |
| 10 | Judge.me Medals | Free | `medals_showcase` | **COMPLETE** |
| 11 | Verified Reviews Counter | Free | `trust_badge` (partial overlap) | **PARTIAL** |
| 12 | All Reviews Counter | Free | `store_reviews` (partial overlap) | **PARTIAL** |
| 13 | Review Snippets | Awesome | — | **MISSING** |
| 14 | Questions and Answers | Awesome | — | **MISSING** |
| 15 | Happy Customers | Awesome | — | **MISSING** |
| 16 | Pop-up Reviews | Awesome | — | **MISSING** |
| 17 | UGC Instagram Shopping | Free | — | **MISSING** |
| 18 | Referrals widget | Awesome | Referral service exists, no storefront widget | **PARTIAL** |
| — | Customer accounts widgets | Free | — | **MISSING** |
| — | All Reviews Page | Awesome | `reviews-site.$slug` public review site | **COMPLETE** |
| — | Collection rating badges | n/a | `collection_rating_badges` | **Imagyn extra** |

Imagyn has 11 theme blocks against Judge.me's ~18. Six are genuinely missing; four are partial
overlaps where Imagyn covers the capability through a different surface.

---

## 4. Functional gap matrix

Status key: COMPLETE, PARTIAL, MISSING, NOT VERIFIED. Effort is engineering days for one
engineer including tests.

### 4.1 Review collection and email automation

| Feature | Judge.me | Imagyn evidence | Status | Effort |
|---|---|---|---|---|
| Automatic request on fulfilment | Free | `webhooks.fulfillments.create.tsx` → `createFromOrder` | COMPLETE | — |
| Configurable delay | Free | `Store.autoRequestDelayDays` | COMPLETE | — |
| Reminder sequence | Awesome, **up to 3**, per order type | 2 reminders, `reminder1DelayDays` / `reminderFinalDelayDays` | **PARTIAL** | 3 |
| Per-order-type timing (domestic/international/POS) | **Awesome, EARLY ACCESS only** | Single global delay | **NOT A PARITY BLOCKER** — see JUDGEME_COMPETITIVE_RESEARCH.md §3 | 4 |
| Delivery-based trigger | Awesome | Only `fulfillments/create` | **MISSING** | 3 |
| Requests for past orders | Free | `app.requests.orders.tsx` bulk picker | COMPLETE | — |
| Manual single + batch requests | Free | `createManyFromOrders` | COMPLETE | — |
| Review link / QR code collection | Free | Token links exist; no QR surface | **PARTIAL** | 2 |
| SMS requests | **Judge.me does not send SMS.** SMSBump deprecated; replacement is an EARLY-ACCESS Shopify Flow trigger routing through the merchant's own tooling | Flow trigger exists for new reviews | **RESCOPED** — add a request-ready Flow trigger, do not build an SMS sender | 2 |
| Multi-language request emails | Awesome; translated product/variant names in widgets are EARLY ACCESS | None | **PARTIAL GAP**, smaller than first estimated | 5 |
| Email template customisation | Awesome | Email Studio, on every plan | **COMPLETE, more generous** | — |
| Prebuilt template library | Awesome | `emailTemplatePresets.ts` — Minimal, Modern, Editorial, Classic, Product Showcase; applied to the draft, presentation only | **COMPLETE (2026-11-06)** | — |
| Unsubscribe + suppression | Free | `emailSuppression.server.ts`, HMAC tokens | COMPLETE | — |
| Bounce/complaint suppression | Free | `webhooks.resend.tsx` | COMPLETE | — |
| Branded sender name | Awesome | `canUseBrandedEmailSender`, **fixed this session** | COMPLETE | — |
| Verified Reply-To | Awesome | `emailSenderIdentity`, not plan-gated | COMPLETE | — |
| **End-to-end delivery proof** | n/a | Five real messages accepted by Resend, both flows, both Reply-To rules confirmed (2026-11-05) | **VERIFIED for acceptance and headers.** Inbox PLACEMENT still unverified — see `EMAIL_DELIVERABILITY_FINDINGS.md` | — |

### 4.2 Customer submission experience

| Feature | Judge.me | Imagyn evidence | Status | Effort |
|---|---|---|---|---|
| Star rating, body, title | Free | `api.reviews.tsx`, `r.$token.tsx` | COMPLETE | — |
| Photo upload | Free, 5 images at 10 MB | `reviewMedia.server.ts` | COMPLETE | — |
| Video upload | Free, 1 video at 100 MB | `reviewMedia.server.ts` | COMPLETE | — |
| YouTube link reviews | Free | None | **MISSING** | 2 |
| Multi-step form | Free | Single form | **PARTIAL** | 3 |
| Quick star-only ratings | Free | Content required | **MISSING** | 1 |
| Title auto-fill from body | Free | None | **MISSING** | 0.5 |
| Anonymous reviews | Early access | None | **MISSING** | 1 |
| **Custom questions / attributes** | Awesome | **No model** | **MISSING** | 8 |
| Store review prompt after product review | Free | None | **MISSING** | 2 |
| Prompt for other products in order | Free | None | **MISSING** | 2 |
| In-email star rating | Pricing page implies | `email.shared.ts` `buildRatingUrl`/`parseRatingParam`, the `stars` section in `ReviewRequestEmail.tsx`, pre-selection in `r.$token.tsx` | **COMPLETE (2026-11-06)** — five glyph stars, all five linking to the identical form | — |
| Character limits enforced both ends | 100 / 5000 | `validateReviewInput` | NOT VERIFIED against those exact limits | 0.5 |

### 4.3 Moderation and management

| Feature | Judge.me | Imagyn evidence | Status | Effort |
|---|---|---|---|---|
| Publish / hide | Free | `setReviewStatus` | COMPLETE | — |
| Merchant reply | Free | `replyToReview`, tenant-scoped | COMPLETE | — |
| AI reply drafts | Awesome, 3 tones (Direct/Elegant/Friendly), 500/day cap, no bulk | `aiReplyDraft.server.ts`, `ai/replyTone.shared.ts` | **COMPLETE on tone (2026-11-06)** — the same three voices. No daily cap implemented (Imagyn has no per-store AI quota at all yet) | 1 for the cap |
| Pin / feature | Free | `featured` flag | COMPLETE | — |
| Bulk actions | Free | Bulk mutations present | COMPLETE | — |
| Automatic moderation rules | Free | `moderationRules.server.ts` | **COMPLETE, exceeds benchmark** | — |
| New-review merchant email | Free | `reviewNotifications.server.ts` | COMPLETE | — |
| Review translations | Awesome | None | **MISSING** | 6 |
| Q&A moderation | Awesome | No model | **MISSING** | included in Q&A |

### 4.4 SEO, Google and syndication

| Feature | Judge.me | Imagyn evidence | Status | Effort |
|---|---|---|---|---|
| JSON-LD rich snippets | Free | `structuredData/` | COMPLETE | — |
| Google review sync / feed | Free | `googleReviewFeed.server.ts` | COMPLETE | — |
| Google Shopping | Awesome | Feed exists | **PARTIAL** | 2 |
| Shop App sync | Free | None | **MISSING** | 5 |
| Amazon / Etsy / AliExpress sync | Free | AliExpress importer only | **PARTIAL** | 6 |
| Meta / TikTok Shop sync | Awesome | None | **MISSING** | 6 |
| Social media push | Awesome | None | **MISSING** | 4 |
| All-reviews public page | Awesome | `reviews-site.$slug` | COMPLETE | — |

### 4.5 Rewards, imports, integrations, analytics

| Feature | Judge.me | Imagyn evidence | Status | Effort |
|---|---|---|---|---|
| Coupons for reviews | Awesome | `coupons.server.ts`, real Shopify discounts | COMPLETE | — |
| Referral programme | Awesome | `referrals.server.ts` | **PARTIAL**, no storefront widget | 3 |
| Review rewards | Awesome | `rewards.server.ts` | COMPLETE | — |
| Importers | Free | Judge.me, Loox, Stamped, Ali, CSV | **COMPLETE, exceeds benchmark** | — |
| Import history / undo | Not documented | `ImportBatch` + undo | **Imagyn extra** | — |
| 130+ integrations (Klaviyo, Gorgias…) | Awesome | Shopify Flow trigger only | **MISSING** | 15+ |
| Public API | Awesome | `api.public.v1.*` read-only | **PARTIAL** | 5 |
| Analytics | Awesome | `analytics.server.ts`, dashboard | **PARTIAL** | 4 |
| A/B testing | Pricing page claims | None | **MISSING** | 8 |

---

## 5. Where Imagyn already beats the benchmark

Worth protecting rather than trading away for feature count:

- **Price.** $9.99 against $15, with several Awesome-tier features already free.
- **Email Studio on every plan.** Judge.me charges for email design customisation.
- **Automatic moderation rules.** Rating threshold, verified-buyer requirement, link and
  profanity holds, banned-word list. Not a documented Judge.me capability.
- **Import provenance and undo.** `ImportBatch` with per-batch undo and an explicit policy
  separating a source platform's verification claim from Imagyn's own.
- **Trust Certification and Medals.** Comparable to Judge.me medals, plus a certification
  surface Judge.me does not document.
- **Brand Studio.** Global brand with per-surface overrides, a cleaner model than per-widget CSS.

---

## 6. Critical bugs and commercial risks

Ordered by commercial severity.

1. **No end-to-end email proof.** Not one review-request email has ever been sent. Email is
   the core loop of the product. Everything else in the request pipeline is inference until a
   real message is delivered and rendered. **Highest risk on this list.**
2. **Pro trial length unverified.** Code advertises 7 days; the real value lives in Shopify
   Managed Pricing in the Partner Dashboard. If it still reads 14, the billing page is making a
   promise Shopify will not honour. Cannot be checked from the repository.
3. **No CI.** Every green gate is a local run. Nothing re-verifies on push and nothing gates a
   merge.
4. **Floating Reviews widget never seen on a storefront.** Ships as Pro-tier parity with
   Judge.me's Floating Reviews Tab, with no visual verification at any breakpoint.
5. **Entitlement drift is a proven class of defect.** One instance shipped and survived months
   of green tests. It is fixed and pinned now, but the lesson is that pricing copy and
   entitlements need a structural link, not vigilance.
6. **Two Pro features advertised as "coming soon."** Advanced email styling and advanced
   analytics. Honestly tagged, but a paid plan listing unbuilt items invites refund requests.
7. **No refund, cancellation, or return handling** in the request lifecycle. Only
   `fulfillments/create` is subscribed, so a refunded order can still receive a request.
8. **`Brand Assets/` is untracked and not gitignored.** 3.3 MB of binaries one `git add -A`
   away from entering history.

---

## 7. Dependency-aware roadmap

Each stage is independently shippable and testable. Later stages depend on earlier ones.

**Stage 0 — Trust the pipeline (3 days).** End-to-end email delivery proof using the
accelerated harness already built. CI workflow running tests, typecheck, lint, build. Confirm
the Managed Pricing trial. *Blocks nothing technically; everything else is guesswork without
it.*

**Stage 1 — Close collection parity (12 days).** Third reminder. Per-order-type timing.
Delivery-based trigger. Refund and cancellation handling. QR code collection. *Depends on
Stage 0, since every item here is an email path.*

**Stage 2 — Submission experience (14 days).** Multi-step form, quick star-only ratings, title
auto-fill, YouTube link reviews, store-review prompt, other-products prompt, in-email star
rating. *Depends on nothing; parallelisable with Stage 1.*

**Stage 3 — Custom questions and Q&A (16 days).** Two new models plus moderation plus a
storefront widget. The largest single gap and the one Judge.me monetises hardest. *Depends on
Stage 2's form work.*

**Stage 4 — Widget parity (14 days).** Testimonials Carousel, Reviews Grid, Review Snippets,
Happy Customers, Pop-up Reviews, Referrals widget. *Depends on Stage 3 for the Q&A widget.*

**Stage 5 — Syndication and SEO (17 days).** Shop App sync, Google Shopping completion,
Amazon/Etsy sync, social push. *Independent.*

**Stage 6 — Translations and multi-language (14 days).** Review translation and multi-language
request emails. *Depends on Stage 1 for the email template layer.*

**Stage 7 — Integrations and analytics (19+ days).** Klaviyo and Gorgias first, write API,
deeper analytics. *Depends on a stable public API.*

**Total to credible parity: roughly 109 engineering days**, about five to six months for one
engineer. Stages 0 through 4 — about 59 days — deliver the parity a merchant comparing the two
apps would actually notice.

---

## 8. Testing requirements

Nothing is marked complete on code existence. Each feature needs:

- Unit and service tests with tenant isolation proven, following the existing convention.
- A development-store journey test: install, onboarding, product sync, request, reminders,
  submission, moderation, storefront display, reward.
- Accelerated reminder timing via the existing harness, with production schedules untouched.
- Real Resend delivery only to the authorised inbox, only after sender configuration is verified.
- Storefront verification at desktop, tablet, and 375 px, covering drawer open and closed, long
  reviews, reviews with and without media, verified and unverified, and the zero-review case.
- Plan gating proven for Free, Pro, trial, and direct API access.

---

## 9. Definition of full functional parity

Parity is reached when all five hold:

1. Every Judge.me Reviews capability in section 4 is COMPLETE or consciously declined with a
   recorded reason.
2. A merchant can run the entire journey on a development store without touching the database
   or the codebase.
3. Every advertised Pro feature is provably delivered to a Pro merchant, with a test pinning it.
4. Real email delivery is verified for the initial request and every reminder.
5. Every storefront widget is verified on a real theme at three breakpoints.

Explicitly **not** parity: matching widget count, copying Judge.me's visual design, or
reaching feature count at the cost of reliability or tenant isolation.

---

## 10. Two blockers carried forward

1. **`RESEND_FROM_EMAIL` is empty locally.** Live delivery needs an address on a domain
   verified in the Resend account. It will not be invented.
2. **One pending migration on the local database** (`Store.contactEmail`, two additive nullable
   columns). The accelerated harness cannot run until it is applied. Local only; production
   untouched either way.

Recommended next step is Stage 0, which both blockers sit inside.

---

## 11. First-hand UI research — 2026-11-07

Everything above §10 was read from Judge.me's public documentation. This section is different:
Judge.me is installed on the `verveonline` development store and was **opened and inspected
directly** in the Shopify admin. This is the first time the real product UI has been seen.

**Evidence quality.** Layout, navigation, labels, controls and empty states are browser-verified.
The store has **0 reviews in Judge.me**, so no populated table, row actions, detail view, bulk
operations or filter behaviour could be observed — those remain **unverified** and must not be
assumed from the documentation.

### 11.1 Navigation

Primary nav is four items: **Reviews · Analytics · Settings · Resources**. There is no separate
"Dashboard" item — the dashboard is what the app root shows.

The Reviews area has its own workspace tabs: **Reviews · Review requests · Customer questions**.
This is the three-tab structure the Review Management brief asked for. Imagyn has the first two;
Customer questions has no data model in Imagyn at all.

### 11.2 Review Management — the benchmark screen

Four stacked bands, roughly 190px in total before any data:

1. **Workspace tabs** — Reviews / Review requests / Customer questions, each with a small icon.
2. **Page header** — `Reviews` as the only title, with inline live-state pills beside it
   (`Sentiment analysis: On` with a working toggle, `Auto-publish: On`) and right-aligned
   actions: `Import`, `Publish and moderate`, `Edit product review groups`, `Export ⌄`.
3. **Category tabs with counts** — `All Reviews (0)`, `Pending (0)`, `Product Reviews (0)`,
   `Store Reviews (0)`, `Spam (0)`, `Archive`, plus a search icon and a sort icon right-aligned.
4. **Filter row** — `Status`, `Source`, `Rating`, `Type`, `Sentiment`, `Topics`, `Tags`,
   `All time`. Eight dropdowns on one line.

Notable: **one** H1 and no section sub-heading above the table. Imagyn printed `Reviews`, a
subtitle, and then a second `Review management` heading plus a count line — three headings for
one table.

### 11.3 Typography — calibration

Judge.me uses **no uppercase anywhere** in the Reviews screen: not the tabs, not the filters, not
the table headers. The single exception is the Settings sidebar, which uses uppercase only for
**group labels** (`REVIEW COLLECTION`, `REVIEW DISPLAY`, `DISCOUNT AND REWARDS`, `INTEGRATIONS`,
`GENERAL`).

That is the rule worth copying: uppercase is for navigation group labels, never for table
headers, card eyebrows or section labels.

### 11.4 Settings IA — the full feature map

21 sections in five groups. This is the competitive feature map.

| Group | Sections |
|---|---|
| Review collection | Import reviews · Request reviews · Request scheduling · Email templates · Product management · Bundles · Collection flow · Optimize collection · Publishing and moderation |
| Review display | Widgets · Product groups · Social sharing · Google, SEO and AI |
| Discount and rewards | Coupons · Referrals |
| Integrations | Integrations |
| General | Plan · Branding · Language · Admin notifications · Advanced |

Settings is a two-pane layout: a persistent, **searchable** left nav (`Ctrl + Shift + F`) beside
a content pane, with a `Request improvements` button pinned under the nav.

Sections with no Imagyn counterpart at all: **Bundles**, **Collection flow**, **Optimize
collection**, **Product groups**, **Referrals**, **Language**.

### 11.5 Dashboard

Setup guide first (`0 of 2 tasks complete`, with `Enable Judge.me on your store` and
`Enable Reviews Widget`), then a metric row — Reviews, Average rating, Requests sent,
**Revenue from Judge.me**, and **Trust scores** (Transparency, Authenticity) — with a
`Last 30 days` range control and `View analytics`. Below that a Status row: Tasks, Widgets
(`Embed disabled`), Requests (`Requests enabled`).

Metric labels carry dotted underlines, i.e. each has an explanatory tooltip.

`Revenue from Judge.me` and the `Trust scores` pair have no Imagyn equivalent.

### 11.6 Plan presentation

The header shows `Free plan · 15-day free trial →` as a persistent pill. Judge.me's paid tier is
surfaced constantly but unobtrusively, in the chrome rather than as interstitials.

### 11.7 What this changed immediately

Three defects in Imagyn's own Review Management were found by opening it in the same session,
none of which 1,765 passing tests had caught — see commit `20c9aaa`. Reading source is not a
substitute for opening the page.

### 11.8 Coupons — the full configuration model, browser-verified

Judge.me's entire coupon surface is **paid-only**: every block carries the teal star that marks a
premium feature, and on the Free plan the controls render disabled. That is a direct data point
for the Free/Pro split — Judge.me treats review coupons as a paid feature in full.

The settings, as the product actually presents them:

| Block | Setting | Value shown |
|---|---|---|
| Coupon settings | How to generate coupons | `Automatically by Judge.me` (a select — so other modes exist, incl. loyalty-app integration) |
| | Coupon code | prefix `THANKYOU` + auto suffix `-ABC123`, "We'll add a unique identifier for each new coupon code" |
| | Campaign description | free text, "may be used in the coupon email" |
| | Customize coupon email | opens its own editor |
| Show coupon promo when collecting reviews | Show coupon in smart review request emails | recommended, with the warning "Some regions do not allow coupons to be sent in review request emails" |
| | Show coupon widget in Customer Accounts | sub-page |
| | Customize coupon banner text | sub-page |
| Review reward | Review type and discount | `Same discount for all reviews` / `10% for any review` — confirms per-review-type tiering |
| Reward conditions | Who can receive coupons | `Only verified buyers` |
| Requirement and eligibility | Requirement | `No minimum requirement` (minimum order value) |
| | Eligibility | reviewer-only · once per customer · reusable · one-time purchases and first subscription order |
| | Combinations | `No combinations` |
| | Validity | `Expires after 30 days` |

**No rating condition appears anywhere in this surface.** That is consistent with Judge.me having
removed rating-gated rewards for review-integrity compliance, and with Imagyn's own removal of
`rewardMinRating` (see `app/services/rewards.server.ts`).

**Confirmed Imagyn gaps**, each needing a migration and therefore explicit approval:
tiering by review type, discount combinations, subscription-order scope, coupon promo shown
during collection (email and submission form), and a coupon widget in Customer Accounts.

**The pattern worth stealing.** Every setting is a summary row — label, the current value written
in plain language, and a chevron to a detail view. A merchant reads their whole coupon
configuration as sentences without opening anything. It is a far better fit for Imagyn's
settings-heavy screens than the current wall of form fields.

### 11.9 Email templates — the full inventory

`Settings → Email templates` (`/settings/review_collection/emails`). Two global actions sit in
the page header, separate from any one template: **Edit sender settings** and **Edit template
styling**. Styling and sender are configured once; each template then carries only its content.

| Group | Template | Default | Paid |
|---|---|---|---|
| Review request and reminder | Store Review Fallback | On, "Smart styling" | — |
| | Smart Email Template | On, "Smart styling" | — |
| Post-review notifications | Review confirmation | On | — |
| | Reply notification | On | — |
| | Media reminder — chases a review left without a photo or video | Off | ★ |
| | Q&A notification | On | ★ |
| Discounts and rewards | Coupon | Off | ★ |
| | Coupon reminder — chases a coupon the customer has not used | Off | ★ |
| | Referrals | Off | ★ |
| | Referral reminder | Off | ★ |

Three things Imagyn does not have:

1. **Request templates are a list, not a singleton.** A `Create ⌄` button makes more of them.
   Imagyn has exactly one review-request template.
2. **Media reminder** and **Coupon reminder** are second-touch automations. The coupon reminder
   in particular chases unredeemed discounts, which converts directly to revenue.
3. **"Smart styling"** is the named default styling mode, applied before a merchant configures
   anything.

### 11.10 Branding — smaller than expected, and beatable

`Settings → Branding` (`/settings/branding`) is a short page:

- **Color → Primary color**, a swatch plus hex field, defaulting to Judge.me's own teal
  `#108474`, with `Reset to default`. One value drives "the star color, buttons, links and link
  buttons on all widgets and emails".
- **Rating icon** (★ paid), a select defaulting to `Star (Default)`, with a live 3.5-star preview
  rendered in the primary colour directly beneath the control.
- **Store logo**, which is only a cross-link: "Update your logo in Email styling settings".
- **Judge.me trust marks** (★ paid) — `Show Powered by Judge.me in emails` and
  `Show 'Verified Checkmark' in widgets`, both on and locked on the free plan.

**The finding that matters: Judge.me does not derive branding from Shopify.** The default is its
own teal, not the merchant's brand colour, and the logo lives in email styling rather than being
fetched. Imagyn's planned automatic brand identity (§2A/§4A — pull logo, store name and colours
from Shopify on install) would therefore put Imagyn **ahead of** the benchmark, not level with
it. It is a differentiator, not catch-up work, and should be prioritised accordingly.

The second lesson is restraint: brand configuration is *one colour and one icon*, applied
globally to every widget and email, with the preview beside the control. Imagyn's Brand Studio
should not grow beyond what a merchant will actually set.
