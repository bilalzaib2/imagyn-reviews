# Imagyn Reviews — Session Handover

**Date:** 2026-11-05
**Repository:** `/Users/bilalzaib/Code/imagyn-reviews` · branch `main` · HEAD `79537b6`
**Scope of this document:** the Imagyn Reviews Shopify app ONLY. The Imagyn Studios agency
website is a separate project with its own handover; see §11.

Nothing was committed, pushed, deployed, or run against production in this session.

---

## 1. Verified state at session end

| Gate | Result |
|---|---|
| Tests | **1460 passed**, 81 files |
| Typecheck | Clean |
| Lint | Clean |
| Production build | Succeeds |
| CI | Configured, green against an unreachable database |
| Accelerated reminder harness | **22/22 checks passed**, capture mode |

Baseline at session start was 1431 tests. The 29 added are regression coverage for the three
defects found below.

---

## 2. Two production defects found and fixed

Both had shipped, both were invisible to a green test suite, and both were found by running
things rather than reading them.

### 2.1 A Pro feature no paying merchant could use

`canUseBrandedEmailSender` was granted only on the retired `SCALE` tier. Pro inherited `false`
from Free, Scale is unpurchasable, and `owner` is internal — so Email Studio advertised a "Pro"
badge for a feature the Pro plan never received. A merchant could pay, upgrade, and still find
the field locked.

Fixed in `app/services/permissions.ts` by granting it on `GROWTH` and removing it from `SCALE`,
which now inherits. Verified by reverting the fix in a scratch copy: 8 tests failed, then passed
again.

Why tests missed it: every resolver test built its own `{ canUseBrandedEmailSender: true }`
literal, so the resolver was only ever exercised against a *hypothetical* Pro. Closed by wiring
the real plan tables into `emailSenderIdentity.server.test.ts`.

### 2.2 The entire Pro reminder sequence was dead

**This was the more serious of the two.** `dispatchRequestEmail` set `status: "sent"` but never
stamped `sentAt`. That field was written only at creation, and only for a request created with
zero delay. Any request created with a delay lands on `scheduled`, is dispatched by the sweep
through this function, and reached `sent` with `sentAt` still null.

`runDueReminderSweep` requires `sentAt` non-null and anchors both cutoffs to it. So those
requests were **permanently ineligible for reminders** — every order-triggered request (the
auto-request delay defaults to 7 days) plus every manually scheduled one.

Proven on the real database, not inferred:

| Status | Rows | With `sentAt` |
|---|---|---|
| opened | 2 | 0 |
| sent | 4 | 0 |
| pending | 4 | 0 |

Rows at `sent` and even `opened` carried no send timestamp. No row could ever have received a
reminder.

Fixed in `app/services/review-request.server.ts`, conditionally so a resend never re-anchors the
schedule. Existing null rows are deliberately **not** backfilled, which avoids a retroactive
reminder blast. Three regression tests added.

### 2.3 Two tests depended on a live database

Found by running the CI configuration locally. `testEmail.server.test.ts` hit real Prisma
because the saved-template lookup was unmocked; it passed only on a machine with a populated
local Postgres. Mocked, test-only change.

---

## 3. Flow 2 — merchant reply behaviour (Judge.me parity)

**Implemented and tested.** A merchant replying to a new-review notification now reaches the
customer, not Imagyn.

| Header | Behaviour |
|---|---|
| To | Merchant's nominated inbox; falls back to Shopify's `contactEmail` when none is set |
| From | Platform verified domain, merchant-scoped local part, store name as display name |
| Reply-To | **The reviewer's own validated address** |

Also added: order number resolved from the originating `ReviewRequest` where one genuinely
exists, and a body line telling the merchant where a reply will land.

Safety properties, each with a test:

- Reviewer address validated through the existing `isHeaderSafeAddress`, so CRLF, commas,
  semicolons, quotes and angle brackets are **rejected outright, not escaped**. 11 hostile
  inputs covered.
- A missing, malformed, or GDPR-redacted address produces **no Reply-To at all** rather than a
  misleading one, and the notification still sends with working admin links.
- The reviewer's address never appears in the body, only the header.
- An unsafe configured recipient blocks the send entirely.
- Tenant isolation: the review is loaded by `(id, storeId)` together.

**Flow 1 (review request) was already correct** by design. Reply-To resolves verified store
address → template address → Shopify `contactEmail` → platform fallback. Judge.me's behaviour is
the third rung; Imagyn additionally honours explicit merchant choices above it, which is better
and was left alone.

### One contract change worth knowing

The notification recipient now falls back to Shopify's `contactEmail`. Previously, a merchant
who enabled notifications but had no address saved received nothing. Two original tests encoded
that old contract and were updated in place with comments explaining why. **All 27 original
tests in that file are preserved** — I overwrote the file at one point and restored it from
`HEAD` before merging the additions.

---

## 4. Resend configuration

| Item | Status |
|---|---|
| Sending domain | `notifications.imagyn.co`, verified by owner in Resend |
| `RESEND_FROM_EMAIL` | **Set** to `Imagyn Reviews <reviews@notifications.imagyn.co>` |
| `RESEND_API_KEY` | Present, untouched, never printed |
| Live delivery | **Never performed. Zero emails sent, ever.** |

`.env` backup before the change: `/private/tmp/claude-501/-Users-bilalzaib/f03ccde2-3e11-4afd-9938-686acd40d4b9/scratchpad/.env.backup`

Full detail in `docs/RESEND_SENDER_SETUP.md`, including why a Gmail or Outlook address can never
be the From value.

---

## 5. Accelerated reminder harness

`scripts/accelerated-reminder-test.ts`. Runs the complete lifecycle through the real production
scheduling code, compressed from 7 days to minutes.

```bash
# Capture mode — nothing leaves the process.
npx tsx scripts/accelerated-reminder-test.ts --i-understand-this-writes-to-my-local-db --fast

# Real time: initial ≈ minute 1, first reminder ≈ minute 3, final ≈ minute 5.
npx tsx scripts/accelerated-reminder-test.ts --i-understand-this-writes-to-my-local-db

# Live delivery to the authorised inbox only.
npx tsx scripts/accelerated-reminder-test.ts --i-understand-this-writes-to-my-local-db --live
```

**How it accelerates without touching production timing:** both sweeps already accept an
injectable `now`. The harness changes only the clock it passes in. No interval, delay, or
schedule is modified.

**What is real:** the sweeps, the per-store candidate SQL, the pre-send claim and its rollback,
the reminder fields, suppression, plan entitlement, template rendering, and every database
write. The only substitution is the email provider, swapped to `EMAIL_PROVIDER=capture`
(`app/services/notifications/capture.server.ts`).

**Safety rails, both tested:** aborts without the acknowledgement flag; aborts on any non-local
database host. Live mode is hard-coded to `bilal.zaib@outlook.com` with no flag to widen it.
Creates its own rows under an `imagyn-accel-test` prefix and deletes them in a `finally` block.

**22/22 checks pass**, covering: initial dispatch, first reminder, final reminder, no duplicates
at any stage, no claim leaks, status not regressed, review submission stopping reminders,
cancellation, and suppression.

---

## 6. Migration

Applied to the **local development database only**. Railway and production were never contacted;
the host was re-verified as `localhost` at the moment of apply.

| Step | Result |
|---|---|
| Backup | 86,805 bytes, verified: 27 tables, `dump complete` marker, all COPY blocks terminated |
| Backup contents | 3 stores / 34 reviews / 10 requests, matching live exactly |
| Applied | `20261029215838_add_store_contact_email` |
| Columns | `contactEmail` text nullable, `contactEmailSyncedAt` timestamp nullable |
| Data after | 3 / 34 / 10 unchanged |
| Schema | Up to date, 38 of 38 applied |

Backup: `/private/tmp/claude-501/-Users-bilalzaib/f03ccde2-3e11-4afd-9938-686acd40d4b9/scratchpad/imagyn_reviews_dev_pre_contactEmail_20261105_022640.sql`

**Do not re-run this migration and do not overwrite that backup.**

---

## 7. Judge.me parity research

Full matrix in `docs/JUDGEME_PARITY_AUDIT.md`, researched from Judge.me's own Shopify App Store
listing and help centre, not blogs or memory.

**Benchmark:** Free + Awesome at $15/month, 15-day trial. Imagyn is Free + Pro at $9.99, 7-day
trial — roughly two-thirds the price, with several Awesome-tier features already free.

**Widgets:** Judge.me documents ~18 entries. Imagyn has 11 theme blocks. Six genuinely missing
(Testimonials Carousel, Review Snippets, Q&A, Happy Customers, Pop-up Reviews, UGC Instagram),
four partial overlaps.

**Largest gap:** custom questions and Q&A. No model exists for either, and it is what Judge.me
monetises hardest. ~16 days.

**Where Imagyn already wins:** price, Email Studio free on every plan, automatic moderation
rules Judge.me does not document, import provenance with per-batch undo, Brand Studio's
global-plus-override model.

**Effort to credible parity: ~109 engineering days.** Stages 0–4 (~59 days) cover what a
merchant comparing the two apps would actually notice.

---

## 8. Dashboard redesign — requirements captured, NOT implemented

**No redesign work was done.** Be clear about this when resuming.

**Blocker: the reference screenshots never arrived.** The mission referenced attached Judge.me
screenshots; no attachments were present in the conversation. Either re-attach them or confirm
to proceed from the researched information architecture alone.

Requirements as stated by the owner, for the next session:

- Primary green `#5C9754`, white and off-white foundations, refined neutral greys, subtle
  borders, restrained shadows, consistent radii. Green used selectively for active and positive
  states only.
- Clean modern sans-serif; Helvetica or Geist, or the existing approved typography if already
  properly implemented.
- Dashboard: overview metrics, reviews over time, rating distribution, pending tasks, widget
  status, automation status, recent reviews, recommendations.
- AI summary surface showing only genuinely generated and stored results. Never invented.
- Tasks and action centre. Polished review management with tabs, filters, bulk actions, tags,
  customer and product context. Complete Email Studio. Reorganised navigation.
- Explicit anti-patterns: no recoloured current UI, no generic AI dashboard cards, no oversized
  empty hero sections, not everything a floating card, no overcrowding.
- Must remain usable inside the Shopify Admin iframe; Polaris composed rather than replaced.

---

## 9. Git state — nothing committed

```
 M app/services/billing/plans.ts
 M app/services/emailSenderIdentity.server.test.ts
 M app/services/notifications/provider.server.ts
 M app/services/notifications/testEmail.server.test.ts
 M app/services/permissions.ts
 M app/services/permissions.test.ts
 M app/services/review-request.server.ts
 M app/services/review-request.server.test.ts
 M app/services/reviewNotifications.server.ts
 M app/services/reviewNotifications.server.test.ts
 M app/services/notifications/emails/NewReviewEmail.tsx
 M .env                                   (RESEND_FROM_EMAIL only)
?? .github/workflows/ci.yml
?? app/routes/app.email-studio.senderIdentity.test.ts
?? app/services/notifications/capture.server.ts
?? scripts/accelerated-reminder-test.ts
?? docs/JUDGEME_PARITY_AUDIT.md
?? docs/RESEND_SENDER_SETUP.md
?? docs/IMAGYN_NIGHT_SHIFT_HANDOVER.md
?? docs/IMAGYN_REVIEWS_SESSION_HANDOVER.md
?? Brand Assets/                          (pre-existing, 28 files, 3.3 MB, untouched)
?? scripts/check-previously-unmatched.ts  (pre-existing, untouched)
?? scripts/verify-import-counts.ts        (pre-existing, untouched)
?? scripts/verify-reviews-pagination.ts   (pre-existing, untouched)
?? skills-lock.json                       (pre-existing, untouched)
```

`Brand Assets/` is 3.3 MB of binaries and is **not gitignored** — one `git add -A` from entering
history. Decide deliberately: commit, move out of the repo, or ignore.

---

## 10. Blockers and next steps

**Needs the owner:**

1. **Judge.me screenshots** for the dashboard redesign (§8).
2. **Authorisation to run the live email leg.** Everything is configured; the harness is ready.
   One sentence authorising a send to `bilal.zaib@outlook.com` on a named test store unblocks it.
3. **Confirm the Managed Pricing trial is 7 days** in the Partner Dashboard. Code advertises 7;
   the binding value lives there and cannot be read from the repository.

**Recommended order next session:**

1. Live email verification — the last unproven link in the core loop.
2. Dashboard redesign, the owner's stated priority alongside parity.
3. Parity Stage 1: third reminder, per-order-type timing, delivery trigger, refund and
   cancellation handling.
4. Then Stage 3's custom questions and Q&A, the largest single gap.

**Known open risks:** no refund/cancellation handling in the request lifecycle (only
`fulfillments/create` is subscribed); the Floating Reviews widget has never been seen on a real
storefront; two Pro features remain honestly tagged "coming soon".

---

## 11. Resuming this project

```
cd /Users/bilalzaib/Code/imagyn-reviews && claude
```

Then: read `CLAUDE.md` first (database-safety policy and the `shopify app dev` gotcha), then
this file, then `docs/JUDGEME_PARITY_AUDIT.md`.

Treat `docs/PROJECT_STATE.md`, `docs/DECISIONS.md` and `docs/CHANGELOG.md` as **stale** — they
stop around 2026-09-13 and `PROJECT_STATE.md` still claims order automation is disabled when it
is live.

The agency website is a **different project**: `/Users/bilalzaib/IMAGYN.CO_WEBSITE`. Do not mix
their code, docs, roadmaps or progress. Note that `~/Code/imagyn-website` is the Imagyn *Reviews*
marketing site (Next.js), which is a third codebase again.

---

## 12. Addendum — live delivery attempt, 2026-11-05

Live sending was authorised for `bilal.zaib@outlook.com` only. **No email was sent. The attempt
is blocked, not failed.**

### Blocker 1 — `RESEND_API_KEY` is empty

| Check | Result |
|---|---|
| `RESEND_API_KEY` line exists in `.env` | Yes |
| Has a value | **No — 0 characters** |
| Present in shell environment | No |
| `RESEND_FROM_EMAIL` | Set correctly: `Imagyn Reviews <reviews@notifications.imagyn.co>` |

An earlier session recorded the key as "present" by checking only that the variable *name*
existed in `.env`. It has no value. Confirmed without ever printing or logging the variable.

The harness's `--live` mode aborted cleanly with `ABORTED: --live needs RESEND_API_KEY`, before
any database write and before any network call. Zero rows were created; zero emails left the
process. The guard works as designed.

**To unblock:** paste the Resend API key into `RESEND_API_KEY` in `.env`, then run:

```bash
npx tsx scripts/accelerated-reminder-test.ts --i-understand-this-writes-to-my-local-db --live
```

Everything else is ready: the verified sending domain, the From address, the authorised-recipient
hard-coding, and the local database.

### Blocker 2 — Partner Dashboard is not reachable from this browser

Asked to re-verify the Pro trial length. `partners.shopify.com` redirected to the public
marketing page, so the browser session is not authenticated against the Partner Dashboard. The
Managed Pricing trial value could not be read. Code still advertises 7 days; the binding value
remains unverified and only the owner can confirm it.

### What one cannot be verified by code

Even with the key in place, *inspecting received mail* requires access to the
`bilal.zaib@outlook.com` inbox, which this session does not have. The achievable evidence is:
Resend's API acceptance plus message IDs, the exact headers submitted, and Resend's own delivery
status per message ID. Confirmation that the mail rendered correctly in the client must come
from the owner opening it.

### Research correction recorded the same day

`docs/JUDGEME_COMPETITIVE_RESEARCH.md` was created from first-hand reading of Judge.me's
early-user-program page. It establishes that several features previously recorded as parity gaps
are **early access, not generally released** — including per-order-type reminder timing,
per-product schedules, unopened-request reminders, and translated widget product names. Judge.me
also does not send SMS at all; the deprecated SMSBump path's replacement is an early-access
Shopify Flow trigger routing through the merchant's own tooling.

`docs/JUDGEME_PARITY_AUDIT.md` has been annotated inline so the two documents do not contradict
each other. **The genuine parity gap is narrower than the original ~109-day estimate.**

---

## 13. Addendum — night-shift session, 2026-11-06

This session was instructed to stop waiting on the two blockers in §10 (Managed Pricing trial
length, Judge.me screenshots) and to maximise implementation. Both blockers are still open and
still do not block anything that was built.

### Verified state at the end of this session

| Gate | Result |
|---|---|
| Tests | **1609 passed, 86 files** (from 1493 / 82) |
| Typecheck | Clean |
| Lint | Clean |
| Production build | Succeeds; Geist font files land at `build/client/fonts/` |
| Git | HEAD still `79537b6`. 72 changed paths. **Nothing committed, pushed, merged or deployed.** |
| `Brand Assets/` | Untouched |
| Database | **Not touched at all this session.** No migration, no schema change, no write. |

### 13.1 Design system — brand colour and typography now real

`app/styles/design-system.css`.

- **The brand green is in the product.** `#5C9754` existed only in a handover document; the
  code shipped a chartreuse `#97a819` that read as highlighter-yellow. Replaced with a
  three-value family, each with a documented job and a measured contrast ratio:
  `--color-brand` `#5c9754` for fills only (3.49:1 — clears AA for UI components, **not** for
  text), `--color-brand-strong` `#3d6b36` for text (6.26:1 on white), `--color-brand-soft`
  `#e8f1e6`, `--color-brand-border` `#c3dcbd`.
  The old `--color-highlight*` names are retained as **aliases** to the new values, which is
  how the swap reached all 19 existing declarations across seven route stylesheets without
  editing any of them.
- **Geist Sans is self-hosted and live.** `scripts/copy-fonts.mjs` copies two variable `woff2`
  files from the `geist` npm package into `public/fonts/` on both `prebuild` and `predev`;
  that directory is generated and gitignored, the same arrangement
  `public/appearance-preview/` already used. `root.tsx` preloads the roman with
  `crossOrigin="anonymous"`. `font-display: swap` with Helvetica next in the stack, so a
  missing file costs polish and never a blank page. Verified present in the client build.
- **New tokens:** `--font-mono`, `--text-4xl`, four `--weight-*`, three `--tracking-*`, four
  `--leading-*`.
- **Two primitives extracted and adopted, not left as dead code:**
  - `components/ui/Table.tsx` — the house data table, taken verbatim from the convention
    `app.reviews.module.css` and `app.requests.module.css` already shared. **Adopted in
    `app.products.tsx`**, which previously rendered Polaris `DataTable` and a Polaris `Badge`
    beside the app's own buttons. 9 tests.
  - `components/ui/Metric.tsx` + `MetricRow` — the house stat tile, extracted from
    `app._index.module.css`'s `.kpiCard`/`.kpiHero`, values unchanged. **Adopted in
    `app._index.tsx`**, and **82 lines of now-dead KPI CSS were deleted.**
- **`docs/IMAGYN_DASHBOARD_DESIGN_SYSTEM.md`** is the new reference. Its §8 records adoption
  status honestly, route by route, including the two screens still substantially Polaris and
  the two badge languages that still coexist.

### 13.2 Email Studio — the template library

`app/services/emailTemplatePresets.ts`, `app/components/email/TemplateGallery.tsx`.

Five directions — **Minimal, Modern, Editorial, Classic, Product Showcase** — expressed
entirely in the **existing** `EmailTemplateContent` contract. No second content model, no
parallel renderer, no new column.

The contract is the point of the file: a preset changes **presentation only**. It never
touches the subject, preview text, heading, body, closing, button text, logo (any field),
display name, reply-to, `showStoreName`, `showPoweredBy`, or custom HTML. Two narrow
exceptions, both additive and both enforced in `applyEmailTemplatePreset` rather than trusted
to each preset definition:

1. A preset may set `showProduct` **true**, never false.
2. A preset may **reorder** sections, never add, remove, enable or disable one — the
   merchant's own enabled flags are carried across untouched.

Only Product Showcase uses either. A "Keep my colours" checkbox defaults **on** whenever the
template is not still on the shipped charcoal accent, because that accent is usually the
merchant's real brand colour. Nothing persists until Save; the existing debounced preview
re-renders immediately. 30 tests, most of them asserting what a preset does *not* touch.

### 13.3 Judge.me parity — two gaps closed

**One-tap star rating in the email** (audit §4.2, was MISSING, effort 3).

Five tappable stars above the CTA in the request and both reminders. New `stars` section in
the contract, new `starsPrompt` copy field, `buildRatingUrl`/`buildRatingUrls`/
`parseRatingParam` in `email.shared.ts`, pre-selection in `r.$token.tsx`.

Three decisions worth keeping:

- **Every star links to the identical form.** Only the pre-selected rating differs, nothing is
  recorded by tapping, and a one-star tap lands exactly where a five-star tap does. Routing
  low ratings anywhere else is review gating — a Shopify App Store violation and an FTC
  problem, and it is the **app** that gets delisted. Asserted on the rendered HTML, not just
  on the URL helper.
- **`validateEmailStarsPrompt` rejects gating copy at the save boundary.** "Leave us 5 stars!"
  above five clickable stars will not save. A specific phrase list, explainable in the error
  message — a guard rail, not a compliance guarantee.
- **The stars are the ★ glyph, not five images.** Directly because of this project's own Apple
  Mail finding: remote images are blocked by default on first open, and an image star row
  degrades to five broken-image icons. Pinned by a test.

> **This changes outgoing email for every existing store** the first time it deploys: the new
> section defaults to enabled. That is the documented behaviour of the sections contract and
> the feature is worthless switched off by default, but it is a live-email change and deserves
> a deliberate decision before deploy. It is off for the `reward` template, whose CTA is the
> storefront and has no rating to carry, and reversible per template in Email Studio.

**AI reply tone selector** (audit §4.3, was PARTIAL, effort 1).

The same three voices as the benchmark — Friendly, Direct, Elegant — as a closed enum, because
the value reaches a system prompt and a free-text style field would be a prompt-injection
surface on merchant-editable input. `ai/replyTone.shared.ts` holds the client-safe half;
`buildReplyDraftSystemPrompt(tone)` holds the voices. "friendly" is the default and reproduces
the previous prompt **byte for byte**, so a merchant who never touches the control gets
identical drafts. Every honesty rule (answer what they said, acknowledge a real problem, never
invent a fact or a resolution) is shared across all three voices and asserted per voice.

A test found a real latent defect here: an unrecognised tone spliced the literal string
`undefined` into the system prompt. The route validates, so it was unreachable — but it is
fixed with an explicit fallback rather than left for the second caller to discover.

### 13.4 What was deliberately not done

- **The full dashboard redesign is not done.** The design system now exists and two primitives
  are adopted on two screens. The remaining screens are unchanged. The audit in
  §8 of the design-system doc says exactly which. Reference screenshots were again not
  attached, and inventing a visual direction for eleven screens without them would have
  produced work that has to be redone.
- **`app.products_.$id` and `app.reviews` were left Polaris.** Converting only the product
  Badge on the detail page would make that one page half-and-half, which is worse than the
  current split — today no single screen looks inconsistent. `ReviewStatusBadge` is the right
  single place to close the badge split.
- **The Notion parity tracker was not updated.** No Notion integration is connected to this
  session; only an unauthenticated connector stub is available.
- **`FEATURE_GAP_MATRIX.md` was not created.** `JUDGEME_PARITY_AUDIT.md` §3 and §4 already are
  that matrix, now updated in place. A second document would be a duplicate that drifts.
- **No database operation of any kind.** No migration was needed; nothing in this session
  touched the schema.

### 13.5 Still open, unchanged

1. **Managed Pricing trial length** — needs someone signed into the Partner Dashboard.
2. **Judge.me reference screenshots** — needed before the remaining screens are redesigned.
3. **Inbox placement** — raise DMARC to `p=quarantine` after a few days of clean sending and
   mark the earlier test messages "not junk". See `EMAIL_DELIVERABILITY_FINDINGS.md`.
4. **The star row's default-on behaviour** needs an explicit go/no-go before deploy.
