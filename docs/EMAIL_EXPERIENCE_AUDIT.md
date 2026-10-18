# Email Experience Audit & Competitor Research (2026-10-19)

Internal working document for the Email Studio / automation / rewards overhaul. Written
before implementation, per the brief. Competitor behaviour here is sourced only from public
documentation (links below) — no private dashboards or source were accessed. Claims about
IMAGYN behaviour were traced through the code, not inferred from UI labels or tests.

---

## 1. Competitor research matrix

| # | Competitor pattern | Benefit | Source | IMAGYN today | Gap | Proposal |
|---|---|---|---|---|---|---|
| 1 | **Branding is global.** Judge.me: "Your brand styling — logo, colours, fonts, and footer — comes from Settings > Branding and is applied to every email automatically." | Upload once, every email updates. No stale per-template copies. | [JM editor](https://judge.me/help/en/articles/16005627-using-the-email-template-editor) | Logo lives in **each template's** JSON (`logoUrl`/`logoDarkUrl` per `EmailTemplate.content`). `applyBrandingToAllTemplates` copies a value into all four, so each holds its own stale snapshot. | **Critical.** Four uploads, and a changed logo leaves old URLs behind. | Store-level shared branding as the source of truth; templates inherit by default with an explicit opt-in override. |
| 2 | Loox hybrid: "Global email style" designer applies to all emails, with per-email overrides. | Shared default without losing per-email control. | [Loox appearance](https://support.loox.io/support/solutions/articles/501000162456-customizing-your-email-appearance) | No shared layer at all. | Same as #1. | Inherit-by-default + labelled override, matching the hybrid model. |
| 3 | Reward coupons are generated and sent **automatically** after a qualification check. Judge.me waits ~30 min, then "we check if the customer and their review qualify for a reward based on your settings." | Merchant never hand-makes a coupon per reviewer. | [JM coupons](https://judge.me/help/en/articles/8379747-offering-judge-me-generated-coupon-codes-for-reviews) | **Already automatic** — see §3. | None on the core flow. | Keep. Fix sender identity on the reward email only. |
| 4 | Coupon restrictions: reviewer-only, one use per customer, usage limits, optional prefix. | Prevents abuse of a public code. | [JM coupons](https://judge.me/help/en/articles/8379747-offering-judge-me-generated-coupon-codes-for-reviews) | `usageLimit: 1` + `appliesOncePerCustomer: true` on the real Shopify discount. | Close. No prefix option, no minimum-order rule. | Out of scope now; note for later. |
| 5 | Qualification conditions: any review / photo-or-video / video only, plus verified-buyer scoping. | Rewards the behaviour the merchant wants. | [JM coupons](https://judge.me/help/en/articles/8379747-offering-judge-me-generated-coupon-codes-for-reviews) | `evaluateEligibility` supports status, rating, verifiedPurchase, hasPhoto, hasVideo. | Comparable. | Keep. |
| 6 | Reminder delays are measured from a clearly stated anchor. Loox: reminder 1 from the original request; reminder 2 **from when reminder 1 was sent**. | Merchant can predict the real send date. | [Loox reminders](https://help.loox.io/article/30-what-are-review-request-reminders) | `reminder1DelayDays` (3) and `reminderFinalDelayDays` (7) — **both measured from `sentAt` of the initial request**, not chained. | Not a defect, but the UI does not say which anchor it uses. | Do **not** change timing. Label the anchor explicitly in the UI. |
| 7 | Loox ships 2 reminders by default at 1 and 7 days; Judge.me allows up to 3. | A known-good default. | [Loox reminders](https://help.loox.io/article/30-what-are-review-request-reminders) | 2 reminders (first + final), off by default per store. | Comparable. | Keep; make enabled/disabled state explicit in the UI. |
| 8 | Reminders are suppressed once a review is submitted. | No nagging a customer who complied. | [JM reminders](https://judge.me/help/en/articles/11792628-automatic-review-request-reminder-emails) | Enforced in the sweep. | None. | Keep; add explicit regression tests. |
| 9 | Trigger choice (created/paid/**fulfilled**/delivered/archived), fulfilled is the default. | Matches how the store actually ships. | [JM automatic requests](https://judge.me/help/en/articles/8379844-automatic-review-request-emails) | `autoRequestTrigger` defaults to `"fulfillment"`, stored as a plain string. | Only one trigger implemented. | Out of scope now. |
| 10 | Consolidated vs per-product emails, capped at 7 products. | Avoids spamming a multi-item order. | [JM automatic requests](https://judge.me/help/en/articles/8379844-automatic-review-request-emails) | One request per order. | Comparable. | Keep. |
| 11 | "Send test email" from the editor. | Verify before a customer sees it. | [JM editor](https://judge.me/help/en/articles/16005627-using-the-email-template-editor) | Exists, and now resolves the real sender identity. | None. | Keep. |

Competitors are used as functional benchmarks only. No competitor copy, assets, markup or
brand identity is reproduced.

---

## 2. Current email architecture (traced)

Provider is **Resend**, one platform-verified domain (`RESEND_FROM_EMAIL`).

| Email | Trigger | Eligibility | Timing anchor | Template | Suppressed by |
|---|---|---|---|---|---|
| Review request | `fulfillments/create` webhook → `createFromOrder`, or manual | Order/customer eligibility, suppression list, dedupe | `autoRequestDelayDays` after fulfillment (default 7) | `review_request` | Unsubscribe, suppression, duplicate request |
| Reminder 1 | `runDueReminderSweep` | Request `sentAt` ≥ `remindersEnabledAt`; no review yet | `reminder1DelayDays` after **initial request sentAt** (default 3) | `reminder_1` | Review submitted, unsubscribe, reminders disabled |
| Final reminder | `runDueReminderSweep` | same | `reminderFinalDelayDays` after **initial request sentAt** (default 7) | `reminder_final` | same |
| Review reward | Review submission → `issueRewardIfEligible` | `evaluateEligibility` | Immediate, after the discount exists | `reward` | Ineligible, no email on file, discount creation failure |

Sender identity (as of `305c19d`): display name = merchant brand name on Pro else store
name; From address always the verified platform address; Reply-To per template.

---

## 3. Does Review Rewards create a real Shopify discount automatically?

**Yes — this already works end to end, and no manual coupon creation is required.**
Traced through `rewards.server.ts` → `evaluateAndIssueReward`:

1. Idempotency first: one `Reward` row per `reviewId` (unique), checked up front and again
   via a caught unique-constraint race. Retries cannot double-issue.
2. `evaluateEligibility` against the merchant's settings. Ineligible → a `Reward` row with
   `status: "ineligible"` and a reason. **No email.**
3. No customer email on file → `status: "failed"`. **No email.**
4. `createShopifyDiscount(...)` creates a **real** Shopify discount with `usageLimit: 1` and
   `appliesOncePerCustomer: true`.
5. Discount creation fails → `status: "failed"` with the provider's reason. **No email.**
   The brief's "never send an email claiming a reward exists when discount creation failed"
   is already satisfied.
6. Success → `status: "issued"` with `discountCode` + `shopifyDiscountId` persisted, then the
   reward email is sent through the shared Email Studio `reward` template with the real code.
7. Email failure is logged and never rolls back the already-real discount.

**Gaps found (small, real):**
- The reward email passes `fromName: input.storeName` directly, so it bypasses
  `resolveSenderIdentity` — a Pro merchant's branded sender name does **not** apply to it.
- The reward email sends no `Reply-To`, unlike review requests and reminders.

---

## 4. UX problems found

1. **The logo must be uploaded per template.** Four separate uploads; changing it leaves
   stale URLs in the other three. This is the headline defect.
2. `applyBrandingToAllTemplates` copies values rather than establishing a shared source, so
   the templates and Brand Studio can silently disagree.
3. The reminder UI does not state which anchor a delay is measured from.
4. Reward email ignores the branded sender name.

---

## 5. Risks and compatibility

- Existing merchants have per-template logos. A naive shared-logo default would blank them.
  **Resolution strategy:** a template whose stored content already has a non-null `logoUrl`
  and no explicit `logoSource` is treated as `"custom"` — it keeps exactly the asset it has.
  Everything else defaults to `"shared"`. This is applied in the content normaliser, so it
  needs no data migration and cannot lose a merchant asset.
- No existing schedule, template copy or reward configuration is changed.
- New customer-facing automation stays disabled pending explicit approval.
