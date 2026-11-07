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
| Workspace tabs | Reviews · Review requests · Customer questions | All three | **Built, unverified** | Closed `2c818e3` |
| Category tabs | All · Pending · Product · Store · Spam · Archive, each with counts | All · Pending · Approved · Rejected · **Archive**, all counted | Partial | Only Product-vs-Store and a Spam view remain |
| Filters | Status · Source · Rating · Type · Sentiment · Topics · Tags · date | Status · rating · product · date · verified | Partial | Source, type, sentiment, topics, tags missing |
| Review table | Not observable (0 reviews) | 6 columns, full width, container-responsive | Built, unverified | Compare once Judge.me has data |
| Detail view | Not observed | Drawer < 64rem, second column ≥ 64rem (`20c9aaa`) | Built, unverified | Never seen rendered |
| Bulk publish | Checkbox select → "Publish reviews" (help centre) | `bulkApprove` | Built, unverified | Behaviour matches |
| Bulk hide | Select → "Hide reviews" → **reason required** (help centre) | `bulkReject` + required reason | **Built, unverified** | Closed `5f3d4fc` |
| Archive | Per-review, three-dot menu; own tab | Own view, single + bulk, restore | **Built, unverified** | Closed `8c36d09`; Imagyn also has **bulk** archive, which Judge.me's docs do not describe |
| Spam | **Not a status** — a hide *reason*, surfaced as a tab | `hiddenReason` stores it; no tab yet | Partial | The data exists; the Spam view is now just a filter |
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
| Q&A notification | Paid, on | Missing | Missing | Model now exists; email not wired |
| Coupon email | Paid | Yes | Built, unverified | — |
| **Coupon reminder** | Paid — chases unredeemed coupons | Missing | Missing | Direct revenue impact |
| Referral emails | Paid | Yes (Referral models) | Built, unverified | — |
| One-tap star rating in request | Not seen | Yes | Built, unverified | Imagyn ahead |

## 4. Branding and storefront

| Feature | Judge.me | Imagyn | Status | Gap / action |
|---|---|---|---|---|
| Brand colour | One primary colour, **defaults to Judge.me teal** | Brand Studio | Built, unverified | Auto-derive is **blocked**: see §6c |
| Logo | Cross-link into email styling | Shopify logo sync exists | **Unverified — may never fire** | See §6c |
| Rating icon | Paid, selectable | Missing | Missing | Low value |
| White-label | Paid | Plan-gated | Built, unverified | — |
| Widgets | ~22, per-theme gallery, app-embed gating | `Widget` model, widgets + add-to-theme routes | Partial | Count and gallery UX both behind |
| AI reviews summary | Paid widget | Yes | Built, unverified | Level |
| Product / store FAQs | Paid widgets | Missing | Missing | `getPublicQuestions` is the read side; no widget yet |

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
| Revoke an issued code | Not documented | Yes — deactivates the real Shopify discount | **Built, unverified** | Closed `31031ed`; service existed with no caller |
| Real redemption count | `asyncUsageCount` | Yes — asks Shopify directly | **Built, unverified** | Closed `31031ed`; reports failure rather than "0 uses" |
| Edit a campaign after creation | Yes | **No** | **Missing** | `updateCoupon` exists but has no edit form |

## 6. Compliance — CLOSED 2026-11-07

Judge.me **requires a reason** when hiding or archiving a review, chosen from a fixed list,
stating this is "to align with review transparency policies and consumer protection laws".
Imagyn recorded nothing.

**Closed in `5f3d4fc`.** `Review.hiddenReason` and `Review.hiddenAt` are new, additive and
nullable. They are deliberately separate from `moderationStatus`/`moderationReason`, which the
automated pipeline writes once and never updates: those answer "how did this review first get
its status", the new pair answers "why did a person hide it".

Properties worth keeping true:

- Reasons are **ids from a fixed list**, never free text, so the record stays aggregatable,
  auditable and translatable — and a hand-crafted POST cannot write arbitrary strings into it.
- **Restoring clears both.** A stale reason would misreport a live review as hidden everywhere
  the column is read, including any Spam view built over it.
- **Bulk hide keeps the same record** a single hide keeps, so a merchant cannot skip the reason
  by selecting two reviews instead of one.
- Questions use the same vocabulary, so there is one list to maintain.

**Archive followed in `8c36d09`**, approved separately. `Review.archivedAt`, additive and
nullable. It is deliberately a second axis rather than another status:

| | Hide | Archive |
|---|---|---|
| What it means | a moderation verdict | filing something away |
| Stays in the working queue | yes, wearing its reason | no — its own view |
| On the storefront | no | no |
| Counted in statistics | as a rejected review | not at all |
| Writes `status` / `hiddenReason` | yes | **never** |
| Reversible | approve | restore |

Because archiving writes no moderation fields, a review can be hidden *and* archived, and
restoring returns the exact state it left with. Restore recomputes `isPublished` from the
status each review kept, so a rejected review cannot be promoted onto the storefront by being
restored — and bulk restore groups by status for the same reason rather than issuing one
blanket update.

The silent risk was the reads, not the writes: any storefront query or statistic that forgot
`archivedAt` would keep showing and counting an archived review without throwing. The scope is
therefore spelled once as `LIVE_REVIEW` and applied across the twelve public APPROVED reads
plus product stats, store stats and customer history, with a test asserting no public read is
still scoped on `deletedAt` alone.

## 6a. Placeholder-control audit — 2026-11-07

Every merchant route and component was scanned for controls that look functional and are not:
`href="#"`, no-op handlers on enabled controls, and "Coming soon" labels on things a merchant
can still click.

**Result: none.** The only "Coming soon" copy in the app sits on genuinely disabled controls —
Settings → Requests puts its unavailable trigger types in a disabled `Select` with help text
naming what each is waiting on (Shopify webhook approval), and the import sources branch on an
`available` flag. That is the right pattern and it is now enforced by
`app/routes/noPlaceholderControls.test.ts`, verified non-vacuous by planting a dead link, a
no-op button and an unguarded label and confirming all three rules fire.

## 6b. Coupons and email — verification pass, 2026-11-07

**Three coupon service methods had no caller anywhere in the UI.** `coupons.server.ts` was
complete, tenant-scoped, Shopify-integrated and tested, and a merchant still could not reach
`revokeRedemption`, `checkRedemptionUsage` or `updateCoupon`. A service with no caller is not a
feature, and no service-level suite notices. Revoke and usage-check are now wired
(`31031ed`); `updateCoupon` needs an edit form and remains open. A contract test now asserts
every method is reachable and **names the ones that are not**, so the next such gap is visible
rather than silent.

**No reward is conditional on rating** — re-confirmed, and now guarded structurally as well as
behaviourally: `evaluateEligibility` must not read `review.rating`, no `minRating` may survive
in the code, and the retired schema column must keep its 16 CFR Part 465 warning.

**Email delivery is verified for real**, not by preview or mocks. Four emails were accepted by
Resend with message ids, to the authorized test inbox only, covering `review_request`,
`reminder` and `reward`. Confirmed live: the From header resolves to the merchant-scoped
address `Verve Outdoor <requests+verveoutdoor.com@notifications.imagyn.co>`, and Reply-To is
carried through. Precedence is verified store address → template address → Shopify
`shop.contactEmail` → platform fallback.

One defect fixed on the way (`31031ed` follow-up): the template Reply-To went into the mail
header after a plain trim, while the Shopify-sourced address beside it was re-validated with
the reasoning written down — "this is the value that actually becomes a header". Not
exploitable, because Email Studio rejects a malformed address on save, but that is one
caller's validation of one path. Both now go through `isHeaderSafeAddress`.

## 6c. Shopify brand assets — the API question, settled as far as it can be

The long-standing assumption was that Imagyn could auto-derive brand identity from Shopify and
thereby lead the benchmark. That assumption is now **in doubt**, and the honest state is:

- **`Shop.brand` — with `colors`, `logo`, `squareLogo`, `coverImage` — is documented on
  Shopify's STOREFRONT API**, not the Admin API. A Shopify community thread asking for a
  shop-logo equivalent on Admin was answered with "theme or checkout branding".
- The nearest Admin equivalent is **`CheckoutBranding`**, which needs
  `read_checkout_branding_settings` **and a Plus or Development store plan** — unusable as a
  general default for ordinary merchants.
- `app/services/shopBrandLogo.server.ts` queries `shop.brand.logo` **through the Admin API**.
  Whether that works has never been verified against a live shop.

**Not verified, and why.** The Shopify MCP needs re-authentication, and the Admin token stored
locally is expired (401), so a live introspection could not be run. Local evidence is weak but
consistent: all three dev stores show `shopBrandLogoUrl = null`, `syncedAt = never`.

**What was done instead of guessing.** The fetch now distinguishes its three outcomes — a
GraphQL error (field likely absent), `brand` resolving to null, and a merchant who simply has
no logo — and warns on the first two. If the field is absent on Admin, the first real install
says so in one log line. Previously all three collapsed to `null` and the feature would have
looked healthy while doing nothing indefinitely.

**To settle it:** re-authenticate the Shopify MCP (`/mcp`) and introspect `Shop`, or read the
warning after one real install.

## 6d. Fresh-install experience

**Gap found and closed:** the Dashboard setup guide had four steps and none was *get a widget
onto the storefront* — the one step without which a shopper can neither read nor leave a
review. A new merchant could complete the whole checklist and still have a storefront showing
nothing. Added as the second step (`19 commits` / see handover §16).

**`done` reads a configured widget, not a live theme.** Detecting real theme installation the
way Judge.me does needs the `read_themes` scope, which this app does not request; adding it
forces every existing merchant to re-authorize. **Decision for the owner.** Until then the
label claims only what the signal proves.

**Defaults reviewed.** Two worth the owner's attention:

| Default | Value | Assessment |
|---|---|---|
| `autoRequestEnabled` | `false` | **Correct.** Order automation is approved and globally on, so this is a deliberate per-store opt-in to emailing a merchant's customers. Not a default to flip silently. |
| `publicNetworkEnabled` | `true` | **Owner decision.** Reviews are exposed to the public network on install. Documented as a control rather than consent, reversible, and development stores are excluded independently — but it is an on-by-default data-sharing posture worth confirming before App Store submission. |

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
| 1 | ~~`Review.hiddenReason` + `hiddenAt`~~ | **DONE** `5f3d4fc` | — |
| 2 | ~~`Question` model~~ | **DONE** `5f3d4fc` / `2c818e3`. Still to build on it: Q&A widget, FAQs, notification email | — |
| 3 | `Review.isStoreReview` (or nullable `productId`) | Product vs Store review tabs | Medium |
| 4 | Request schedule segments | Domestic / international / POS timing | Medium |
| 5 | Coupon tiering + combinations + eligibility | Coupon parity | Medium |
| 6 | Multiple request email templates | Template list | Low |

Items 1 and 2 were approved and are done. Both migrations are additive and nullable, were
applied to the local development database only, and ship with rollback SQL beside them
(`prisma/migrations/20261106204257_add_hide_reasons_and_questions/rollback.sql`). A verified
backup was taken first and all 34 reviews, 3 stores, 12 products and 10 requests were confirmed
intact afterwards.

| 7 | ~~`Review.archivedAt`~~ | **DONE** `8c36d09` | — |

Remaining: 3 (product vs store reviews), 4 (segmented request scheduling), 5 (coupon tiering,
combinations, eligibility) and 6 (multiple request templates). None started.
