# Imagyn Reviews vs Judge.me — competitive gap matrix

**Date:** 2026-11-07
**Imagyn HEAD:** `4167973` (local, unpushed)
**Judge.me evidence:** the live app on the `verveonline` development store (Basic · Development
store), plus its help centre where the UI could not be reached. See
`docs/JUDGEME_PARITY_AUDIT.md` §11 for the underlying observations.

## How to read the status column

| Status | Means |
|---|---|
| **Verified** | Implemented, and seen working in a browser |
| **Built, unverified** | Code and tests exist; never seen rendered or exercised end to end |
| **Partial** | Works, but materially narrower than Judge.me |
| **Missing** | No implementation |
| **N/A** | Deliberately out of scope |

Nothing in this file is marked Verified on the strength of a passing test. A test proves the
code does what it was written to do, not that a merchant can use it.

**Standing caveat.** Judge.me's store holds **0 reviews**, so its populated review table, row
actions, bulk operations and filter behaviour could not be observed. Rows that depend on those
cite the help centre and are marked accordingly. Interactions inside Imagyn's own iframe could
not be driven at all (clicks did not reach it), so no Imagyn row is marked Verified from this
session's browser work except the three defects actually observed.

---

## 1. Review management and moderation

| Feature | Judge.me | Imagyn | Status | Gap / action |
|---|---|---|---|---|
| Workspace tabs | Reviews · Review requests · Customer questions | Reviews · Review Requests | Partial | Q&A tab absent until the model exists |
| Category tabs | All · Pending · Product · Store · Spam · Archive, each with counts | All · Pending · Approved · Rejected, now with counts (`4167973`) | Partial | Product-vs-store, spam and archive need schema |
| Filters | Status · Source · Rating · Type · Sentiment · Topics · Tags · date | Status · rating · product · date · verified | Partial | Source, type, sentiment, topics, tags missing |
| Review table | Not observable (0 reviews) | 6 columns, full width, container-responsive | Built, unverified | Compare once Judge.me has data |
| Detail view | Not observed | Drawer < 64rem, second column ≥ 64rem (`20c9aaa`) | Built, unverified | Never seen rendered |
| Bulk publish | Checkbox select → "Publish reviews" (help centre) | `bulkApprove` | Built, unverified | Behaviour matches |
| Bulk hide | Select → "Hide reviews" → **reason required** (help centre) | `bulkReject`, **no reason captured** | Partial | See §6 — compliance-relevant |
| Archive | Per-review, three-dot menu; own tab | Missing | Missing | Needs schema |
| Spam | **Not a status** — a hide *reason*, surfaced as a tab | Missing | Missing | Cheaper than assumed: a reason field, not a new status |
| Reply to review | Yes, with email notification | Yes, with AI drafting | Built, unverified | Imagyn ahead (AI drafting, tone) |
| Search / sort / pagination | Yes | Yes, server-side cursor | Built, unverified | — |

## 2. Review requests

| Feature | Judge.me | Imagyn | Status | Gap / action |
|---|---|---|---|---|
| Scheduling | **Three segments** — domestic / international / POS, each with own trigger, delay, reminders | One global delay | Partial | Real gap; needs schema |
| Per-product timing | Yes (paid) | Missing | Missing | Needs schema |
| Trigger | After fulfilled | After fulfilled | Built, unverified | — |
| Reminder chain | Configurable per segment | Yes | Partial | Not segmented |

## 3. Email

| Feature | Judge.me | Imagyn | Status | Gap / action |
|---|---|---|---|---|
| Request templates | A **list**, creatable | Exactly one | Partial | Multiple templates need schema |
| Global sender settings | Separate page | Yes | Built, unverified | — |
| Global template styling | Separate page | Email Studio | Built, unverified | Imagyn ahead (presets, live preview) |
| Review confirmation | On by default | Yes | Built, unverified | — |
| Reply notification | On by default | Yes | Built, unverified | — |
| Media reminder | Paid, off | Missing | Missing | Chases text-only reviews for photos |
| Q&A notification | Paid, on | N/A | N/A | Depends on Q&A |
| Coupon email | Paid | Yes | Built, unverified | — |
| **Coupon reminder** | Paid — chases unredeemed coupons | Missing | Missing | Direct revenue impact |
| Referral emails | Paid | Yes (Referral models) | Built, unverified | — |
| One-tap star rating in request | Not seen | Yes | Built, unverified | Imagyn ahead |

## 4. Branding and storefront

| Feature | Judge.me | Imagyn | Status | Gap / action |
|---|---|---|---|---|
| Brand colour | One primary colour, **defaults to Judge.me teal** | Brand Studio | Built, unverified | **Imagyn can lead**: auto-derive from Shopify |
| Logo | Cross-link into email styling | Shopify logo sync exists | Built, unverified | Imagyn ahead |
| Rating icon | Paid, selectable | Missing | Missing | Low value |
| White-label | Paid | Plan-gated | Built, unverified | — |
| Widgets | ~22, per-theme gallery, app-embed gating | `Widget` model, widgets + add-to-theme routes | Partial | Count and gallery UX both behind |
| AI reviews summary | Paid widget | Yes | Built, unverified | Level |
| Product / store FAQs | Paid widgets | Missing | Missing | Depends on Q&A |

## 5. Coupons and rewards

| Feature | Judge.me | Imagyn | Status | Gap / action |
|---|---|---|---|---|
| Real Shopify discounts | Yes | Yes — `discountCodeBasicCreate` etc. | Built, unverified | Integration sound |
| Paid-only | **Entire surface paid** | Free/Pro split undecided | Partial | Data point for §9 |
| Code prefix + unique suffix | `THANKYOU-ABC123` | Yes | Built, unverified | — |
| Tiering by review type | Yes — text/photo/video | Gates only, not tiers | Partial | Needs schema |
| Minimum order | Yes | Yes | Built, unverified | — |
| Eligibility options | 4 distinct options | Narrower | Partial | Needs schema |
| Discount combinations | Yes | Missing | Missing | Needs schema |
| Expiry | 30 days default | Yes, configurable | Built, unverified | Imagyn ahead |
| Coupon promo during collection | In request emails + submission form | Missing | Missing | Needs schema |
| Rating-gated rewards | **Absent** (compliance) | **Removed** (`09db694`) | Verified | Both compliant |
| Issued-code visibility | Not observed | Yes (`6278e8c`) | Built, unverified | — |

## 6. Compliance — the highest-priority gap

Judge.me **requires a reason** when hiding or archiving a review, chosen from a fixed list
(Fake, Duplicated review, Spam, Unrelated to the product, …), stating this is "to align with
review transparency policies and consumer protection laws".

Imagyn's merchant can reject a review and **no reason is recorded anywhere**.

`Review.moderationReason` cannot be reused: it is documented as set once at creation by the
Moderation Rules pipeline and never updated, so it answers "how did this review first get its
status", not "why did a human hide it". Overloading it would destroy that meaning.

**Required:** a new nullable column pair on `Review` (e.g. `hiddenReason`, `hiddenAt`), captured
on manual reject and bulk hide, shown in the detail panel and exported. This is the same class
of risk as the rating-gated rewards defect fixed in `09db694`, where liability falls on the app.

## 7. Analytics

| Feature | Judge.me | Imagyn | Status | Gap / action |
|---|---|---|---|---|
| Tabs | Reviews and requests · **Revenue** | Single analytics page | Partial | No revenue attribution |
| Metric tiles | Four, acting as **chart selectors** | Tiles + charts | Partial | Adopt tile-as-selector |
| Collection rate | Headline metric | Not surfaced | Missing | Cheap, derivable from existing data |
| Export report | Yes | Review export exists | Partial | — |
| Peer benchmarking | Announced | Missing | N/A | Needs their dataset |

## 8. Not applicable / deliberately out of scope

Bundles · Collection flow · Optimize collection · Language (i18n) · Judge.me Reviews Site
syndication · Judge.me Medals (Imagyn has its own `app.medals` + `TrustCertification`) ·
Shop app sync.

---

## 9. Migrations required — one approval unblocks the rest

Every item below is schema work. Nothing here will be started without explicit approval.

| # | Migration | Unblocks | Priority |
|---|---|---|---|
| 1 | `Review.hiddenReason` + `hiddenAt` | Moderation reasons, Spam tab, Archive tab | **Compliance — highest** |
| 2 | `Question` model (+ answer fields) | Customer questions tab, Q&A widget, FAQs, Q&A email | High — most visible hole |
| 3 | `Review.isStoreReview` (or nullable `productId`) | Product vs Store review tabs | Medium |
| 4 | Request schedule segments | Domestic / international / POS timing | Medium |
| 5 | Coupon tiering + combinations + eligibility | Coupon parity | Medium |
| 6 | Multiple request email templates | Template list | Low |

Items 1 and 2 are the ones worth doing first: one is a compliance exposure, the other is the
largest visible gap in the product.
