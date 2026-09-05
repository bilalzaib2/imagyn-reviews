# Data Retention Policy

What Imagyn Reviews actually keeps, for how long, and why — written against the real schema
and code, not aspirational. For the Shopify-mandated deletion mechanisms (customer data
request, customer redact, shop redact), see [`app/routes/webhooks.compliance.tsx`](../app/routes/webhooks.compliance.tsx),
which already implements all three and is not changed by this document.

## Data categories

### 1. Review content — retained indefinitely, until shop uninstall

**What:** `Review.content`, `title`, `rating`, media (`ReviewMedia`).

**Why kept:** This is the merchant's storefront content, not the customer's personal data —
the same distinction `handleCustomersRedact` already draws (it redacts the *reviewer's*
identifying fields but keeps the review itself). A merchant who has built up two years of
reviews has a legitimate, ongoing business reason to keep them; there is no privacy
justification for deleting content a merchant is actively displaying.

**How it actually ends:** `SHOP_REDACT` (fires ~48h after uninstall) cascades a full delete
of the `Store` row and everything under it, including every `Review`. There is no
independent "delete old reviews" mechanism, and none is proposed here — that would delete
real merchant content for no privacy benefit.

**Decision needed:** none. This is the correct behavior as-is.

### 2. Reviewer identity on a Review — redacted on customer request, otherwise kept with the review

**What:** `Review.reviewerName`, `reviewerEmail`, `reviewerLocation`.

**How it actually ends:** `CUSTOMERS_REDACT` (Shopify webhook, customer-initiated) nulls
`reviewerEmail`/`reviewerLocation` and replaces `reviewerName` with `"Redacted customer"` —
already implemented, already correct, not touched by this document. Absent an explicit
customer request, these fields live as long as the review does (category 1, above).

**Decision needed:** none. This is the correct, Shopify-mandated behavior as-is.

### 3. ReviewRequest's contact fields (email, name) — the one category with no active retention window today

**What:** `ReviewRequest.email`, `name`, `orderNumber`. This data exists solely to *deliver*
a request/reminder email — once a request reaches a terminal state (`completed`, `failed`,
or `cancelled`), there is no further operational reason to keep the raw email address
indefinitely.

**Current behavior:** kept indefinitely unless a `CUSTOMERS_REDACT` webhook fires for that
exact email. There is no age-based purge.

**What's built, not yet enabled:** `reviewRequestService.purgeStaleContactInfo(storeId, {
retentionDays, limit })` in [`review-request.server.ts`](../app/services/review-request.server.ts) —
redacts `email`/`name` (same shape as `handleCustomersRedact`: null email, a clearly-marked
redacted name) on requests that are both **terminal** (`completed`/`failed`/`cancelled` only
— never `sent`/`delivered`/`opened`/`clicked`, since those could still become a real review)
and **older than `retentionDays`**, bounded per call by `limit` (default 500), fully logged
at a category level (row count only — never the email/name being redacted), idempotent, and
covered by 14 tests in `review-request.server.test.ts`.

**Decision needed — business/legal, not engineering:** the actual number of days. This is
deliberately not hardcoded anywhere and the function is not called by
`reviewRequestScheduler.server.ts` or anything else — it is built and tested, but dormant,
exactly like `ORDER_AUTOMATION_ENABLED` was for a different pending decision. Turning this on
requires: (a) picking `retentionDays` (a reasonable starting point to discuss might be
12–24 months, but that is a suggestion for discussion, not a recommendation being asserted as
correct), and (b) wiring one call into the existing scheduler sweep, once (a) is decided.

### 4. EmailSuppression (unsubscribe records) — retained indefinitely, never purged

**What:** `EmailSuppression.email`, `suppressedAt`, `source`.

**Why kept indefinitely, deliberately:** this table exists specifically to make sure someone
who opted out is never emailed again. Deleting a suppression record after some retention
window would mean **re-acquiring the ability to email someone who explicitly said no** —
the opposite of what consent requires. This is the one category where "delete after N days"
would itself be the compliance violation, not the fix.

**Decision needed:** none. Do not implement a retention purge for this table.

### 5. Session (Shopify OAuth sessions) — already deleted on uninstall

**What:** the `Session` table (access tokens, not personal customer data).

**How it actually ends:** `webhooks.app.uninstalled.tsx` deletes sessions for the shop at
uninstall time; `SHOP_REDACT`'s handler deletes them again defensively (in case the first
delete didn't complete) before deleting the `Store` row. Already correct, not touched here.

### 6. Store/shop records — deleted via SHOP_REDACT, not on any independent timer

**What:** the `Store` row and everything cascading from it (per `onDelete: Cascade` on every
related model).

**How it actually ends:** `SHOP_REDACT`, ~48h after uninstall — a complete, correct erasure
(`deleteStore`). No independent "stale store" purge is proposed; a store with an active
Shopify installation is, by definition, still in use.

## Summary table

| Category | Retention today | Purge mechanism | Status |
|---|---|---|---|
| Review content | Until shop uninstall | `SHOP_REDACT` cascade | ✅ implemented |
| Reviewer identity on a Review | Until customer/shop redact | `CUSTOMERS_REDACT` / `SHOP_REDACT` | ✅ implemented |
| ReviewRequest contact fields | Indefinite (no age purge) | `purgeStaleContactInfo` | 🟡 built + tested, **not enabled** — needs a retention-days decision |
| EmailSuppression | Indefinite, by design | None (intentional) | ✅ correct as-is |
| Session | Until uninstall | `webhooks.app.uninstalled.tsx` / `SHOP_REDACT` | ✅ implemented |
| Store + cascaded data | Until uninstall | `SHOP_REDACT` | ✅ implemented |

## What this document deliberately does not do

- It does not pick a number of days for category 3. That's stated above as a real,
  outstanding business decision — implementing a number here would be guessing at something
  the person filling out Shopify's questionnaire needs to actually decide.
- It does not touch `EmailSuppression`'s indefinite retention — that's correct, not a gap.
- It does not add any new destructive migration, scheduled job, or production behavior
  change. `purgeStaleContactInfo` exists as a tested, callable function and nothing calls it.
