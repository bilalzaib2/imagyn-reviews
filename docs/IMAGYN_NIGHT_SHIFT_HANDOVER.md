# Imagyn Reviews — Night Shift Handover

**Written:** 2026-11-05
**Repository:** `/Users/bilalzaib/Code/imagyn-reviews` (branch `main`, HEAD `79537b6`)
**Author:** Claude Code session that originally ran the Night Shift brief on 2026-09-25

---

## 0. Read this first — the recovery report that prompted this document was stale

This handover was requested on the basis of an in-session recovery report. That report described
the Night Shift work as **half-finished**, with Phases 3, 4, 5 and 7 unstarted and Phase 2
missing its settings UI.

**That report was six weeks out of date and is superseded by this document.**

Two things had changed without the reporting session's knowledge:

1. **The repository moved.** It was at `/Users/bilalzaib/Downloads/imagyn-reviews` during the
   original session. It now lives at `/Users/bilalzaib/Code/imagyn-reviews`. The old path no
   longer exists; a stale `imagyn-reviews.zip` (2025-07-18) and an unrelated empty file at
   `~/imagyn-reviews` are decoys, not the project.
2. **35 commits landed after the original session**, starting with `809c3e1` which committed the
   Night Shift work itself. Every phase was finished, and later sessions then hardened and
   extended it.

Everything below was verified by command output against the current tree on 2026-11-05. Where a
later session changed an original design decision, the change is recorded and the reason given.

---

## 1. The original Night Shift objective

An autonomous, unattended implementation run against the production codebase, with these
standing constraints: inspect before changing, reuse existing architecture, never regress a
shipped feature, never fabricate review or order data, never weaken tenant isolation, no
deploy, no destructive migration, no commit unless the workflow requires it.

Phases 1 through 4 came from the original brief. Phases 5 through 7 were added by the user
mid-session.

| # | Phase | Objective |
|---|-------|-----------|
| 1 | Free plan automatic initial review request | One initial request email per eligible order on Free. No reminder sequence on Free. Preserve delay, suppression, duplicate prevention, unsubscribe. |
| 2 | Merchant new-review email | Notify the merchant on every new customer-submitted review, with real review data and working View and Reply calls to action. |
| 3 | Merchant reply to review | Audit the reply flow; complete only what is missing. Enforce store ownership server-side. |
| 4 | Floating Reviews widget | New theme app extension: floating side tab opening a review drawer, product-aware, Brand Studio integrated. |
| 5 | Customer support widget | Always-available support contact inside the merchant dashboard. |
| 6 | Pro trial | Activate a 7-day trial on the Pro plan. |
| 7 | "Loving Imagyn Reviews?" banner | Fix the button that failed to take the merchant to the app's review page. |

---

## 2. Current status — all seven phases complete

| # | Phase | Status | Evidence in tree |
|---|-------|--------|------------------|
| 1 | Free automatic review request | **Complete** | Plan gate in `app/services/reviewRequestScheduler.server.ts`; later refined by `f1b7c0a` |
| 2 | Merchant new-review email | **Complete** | `app/services/reviewNotifications.server.ts`, `app/services/notifications/emails/NewReviewEmail.tsx`, 14 `newReviewNotify` references in the settings route |
| 3 | Merchant reply deep link | **Complete** | `app/routes/app.reviews.tsx` lines 124–125 read the `review` and `reply` parameters |
| 4 | Floating Reviews widget | **Complete** | `blocks/floating_reviews.liquid`, `assets/floating-reviews.js`, `assets/imagyn-component-floating-reviews.css`, `app/routes/api.reviews.floating.tsx` + its test |
| 5 | Support widget | **Complete, redesigned** | `app/components/ui/FloatingHelp.tsx` + `app/routes/app.support.tsx` |
| 6 | Pro 7-day trial | **Complete in code** | `app/services/billing/plans.ts` line 81 |
| 7 | App review banner | **Complete** | `app/components/ui/AppReviewPrompt.tsx` + `app/services/appStoreListing.server.ts` |

### Phase 1 — what was actually wrong

The order-triggered path was already fully built before the Night Shift began: the fulfillment
webhook creates a request per eligible line item, the in-process sweep dispatches it, and Free
already carried the entitlement. Protected Customer Data approval and the activation flag were
both already live.

One genuine defect was found and fixed. The reminder sweep selected rows on the store's
`reminderEmailsEnabled` preference alone. That preference survives a downgrade, so a store
dropping from Pro to Free kept receiving the Day-3 and Day-7 sequence, violating the Free
product rule. Plan entitlement is now resolved at dispatch time and cached per store per sweep.
A later session (`f1b7c0a`) moved that resolution ahead of the row query, and `77f16e6` and
`69a767a` closed related batch-starvation and historical-backlog defects in the same sweep.

### Phase 2 — design notes worth keeping

- Two new `Store` columns, deliberately **not** folded into the existing moderation-hold
  notification: that one fires only for held reviews and only while Moderation Rules are on.
- The notification loads its review by `(id, storeId)` together, so a foreign review id
  resolves to nothing. The recipient always comes from the owning store's own row, never from
  a caller-supplied address.
- Imported and merchant-authored reviews deliberately never trigger it. A Judge.me or CSV
  migration would otherwise send hundreds of emails in one batch.
- When the held-review notification and this one would land in the same inbox for the same
  submission, the second is suppressed. Different addresses each get their own copy.
- Nothing is fabricated: a review with no title renders without one, and "Verified buyer"
  appears only for a review that genuinely carries that flag.

### Phase 5 — the original approach was wrong and was replaced

The Night Shift built a `mailto:` call to action. That does not work: inside Shopify's embedded
admin, a `mailto:` navigation in the app's own iframe is refused by the frame sandbox, and the
merchant saw only "This content is blocked." A later session replaced it with an in-app form
posting to `/app/support`, which sends the mail server-side. Nothing leaves the admin and no
mail client is involved.

There is still no help centre, chat, or ticketing backend, and none was invented.

### Phase 7 — the fix

The banner now resolves the real App Store listing URL from Shopify via
`appStoreListing.server.ts` rather than a hardcoded `apps.shopify.com` address, and navigates
with `top.location.href` because that page cannot render inside the embedded iframe.

---

## 3. Verification — run fresh on 2026-11-05

| Gate | Command | Result |
|---|---|---|
| Tests | `npm test` | **80 files, 1384 tests, all passed** (36.69s) |
| Typecheck | `npm run typecheck` | **Clean**, no output |
| Lint | `npm run lint` | **Clean**, no output |

For scale: the original session's baseline was 57 files and 759 tests. The suite has roughly
doubled since.

Not verified here, and not verifiable from a terminal: storefront visual QA of the Floating
Reviews widget across desktop, tablet and mobile, and the embedded admin's visual quality.
Both need the real Shopify admin and a live storefront.

---

## 4. Migration status

**No migration was run by the Night Shift session, and none has been run from this session.**

The Night Shift authored one migration by hand, additive only:

```
prisma/migrations/20260925030000_add_new_review_notification/migration.sql
```

It adds two `Store` columns with defaults that reproduce every existing store's current
behaviour exactly. No backfill, no rename, no drop. It is committed under `809c3e1`.

Four further migrations landed afterwards:

| Migration | Purpose |
|---|---|
| `20260930120000_add_public_network_participation` | Public review network opt-in |
| `20261016020000_add_branded_email_sender_name` | Branded sender identity (Pro) |
| `20261019030000_add_shared_email_branding_logos` | Shared email logo |
| `20261019040000_add_reply_to_verification` | Verified Reply-To |
| `20261029215838_add_store_contact_email` | Store contact email |

Deployment runs `prisma migrate deploy` via the `setup` script, so these are applied wherever
the app has been deployed. **This was not confirmed against the live database, deliberately:**
the project treats `DATABASE_URL` as production, and the database-safety policy exists because
a shadow-database operation once wiped production data. Only `prisma generate`, pure local
codegen that never opens a connection, was ever run.

---

## 5. Uncommitted changes

`git status --short` at the time of writing:

```
?? "Brand Assets/"
?? scripts/check-previously-unmatched.ts
?? scripts/verify-import-counts.ts
?? scripts/verify-reviews-pagination.ts
?? skills-lock.json
```

All five are **untracked additions**. There are no modified or deleted tracked files, and
nothing is staged. Nothing was discarded, reverted, or overwritten.

| Path | What it is | Suggestion |
|---|---|---|
| `Brand Assets/` | 28 files, 3.3 MB of binary brand artwork, not gitignored | Decide deliberately: commit, move outside the repo, or add to `.gitignore`. Do not let it drift into a commit unnoticed. |
| `scripts/check-previously-unmatched.ts` | 52 lines, import diagnostics | Keep or delete; one-off investigation tooling |
| `scripts/verify-import-counts.ts` | 75 lines, import diagnostics | Same |
| `scripts/verify-reviews-pagination.ts` | 98 lines, pagination diagnostics | Same |
| `skills-lock.json` | 11 lines, tooling metadata | Likely belongs in `.gitignore` |

---

## 6. Known issues and open items

1. **Pro trial needs an external change.** `plans.ts` now advertises 7 days, but that value is
   display metadata only. The trial a merchant actually receives is configured on the Pro plan
   in **Shopify Managed Pricing in the Partner Dashboard**, which owns the entire purchase
   flow. If that setting still says 14, the billing page is advertising a trial Shopify will
   not honour. **This cannot be changed from the codebase and has not been confirmed.**
2. **End-to-end email delivery has never been verified.** Carried over from the 2026-10-29
   overnight report. No email has been sent. To unblock, supply a test recipient you control,
   confirm the test store, and give one line of explicit authorization.
3. **No CI.** Every green gate above is a local run. Nothing re-verifies on GitHub and nothing
   gates a merge.
4. **Floating Reviews widget has no storefront visual QA.** It passes its endpoint tests and
   builds, but no one has looked at it on a real storefront at three breakpoints, with a long
   review, a review with an image, and the zero-review case.
5. **Refund, cancellation and return handling does not exist** in the review-request lifecycle.
   The Night Shift brief asked to *preserve* it; there was nothing to preserve. Only
   `fulfillments/create` is subscribed. Worth a deliberate decision rather than an assumption.

---

## 7. Orientation for the next session

- Architecture, database-safety policy, and the `shopify app dev` gotcha: `CLAUDE.md` at the
  repository root. Read it before touching anything.
- Most recent verified state of the product: `docs/overnight-completion-report.md`
  (2026-10-28/29) and `docs/PROJECT_STATE.md`.
- Entitlements live in `app/services/permissions.ts` and nowhere else. Plan display copy lives
  in `app/services/billing/plans.ts`. Never branch on a plan name at a call site.
- Storefront widget surfaces inherit Brand Studio through `SurfaceKey` in
  `app/services/appearance.shared.ts`. Adding a surface is a compile-time change, not a schema
  change.

---

## 8. Starting a fresh session

```
cd /Users/bilalzaib/Code/imagyn-reviews && claude
```

Note the path. The old `~/Downloads/imagyn-reviews` location is gone, and starting a session
there will fail or, worse, land in an unrelated directory.
