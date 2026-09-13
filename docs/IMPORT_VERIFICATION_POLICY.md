# Review Import — Verification, Sources, and Behavior Policy

Reference document for `app/services/reviewImportExport.server.ts` and everything under
`app/services/importers/`. Several code comments in that pipeline point here by name — this is
that document. Covers what a migrated review is allowed to claim, which source platforms are
actually verified against a real export, and how duplicate/publication/media/reply data is
handled. Written to be read by a future engineer (or Claude session) before touching the import
pipeline, not just by a merchant.

## 1. The core rule: two different "verified" fields, never conflated

`Review` has two independent boolean-ish fields that must never be merged into one:

| Field | What it means | Who reads it |
|---|---|---|
| `verifiedPurchase` | IMAGYN's own claim: this reviewer's purchase was actually checked by this app | Trust Certification's verified-review count, the storefront "Verified Buyer" badge |
| `sourceVerified` | The **source platform's own** claim (or inference from its export data), preserved for audit only | Nothing. Never read by any trust, badge, AI, or analytics consumer — grep confirms exactly two files reference it: `review.server.ts` (declares/writes it) and `reviewImportExport.server.ts` (computes it) |

**Every review created by the import pipeline gets `verifiedPurchase: false`, unconditionally,
with no exception.** This is hardcoded in `importRow()` — not derived from the row, not
configurable, not something a future column mapping could override. IMAGYN has no way to
independently confirm a reviewer's purchase from a CSV row, so it never claims to.

`sourceVerified` records what the source *said*, honestly:
- `true` — the source made an explicit or inferable positive claim (e.g. a `verified_purchase`
  column set to `true`/`yes`, or Judge.me's `source === "email"`, which Judge.me's own docs
  describe as review-request-triggered and therefore purchase-linked).
- `false` — the source made an explicit negative claim.
- `null` — the source made **no claim at all** (most platforms' documented export schemas have
  no verification column, or the row's own status doesn't map to yes/no). `null` means
  "unknown," not "false" — never collapse the two.

A merchant or admin can see `sourceVerified` as internal, auditable metadata (the Reviews page
detail panel shows "Imported from Judge.me · source claimed verified purchase (not
IMAGYN-verified)" or the equivalent for `null`/`false`) but it is never rendered as, or near, the
real `VerifiedBadge` component, and never contributes to any verified-review count.

**Explicitly prohibited, permanently:** displaying "Verified Buyer" on a storefront review, or
counting a review toward Trust Certification's verified total, merely because
`importSource` is set and the source claimed verification. If a future feature wants to let a
merchant *promote* a source-verified import to a real IMAGYN-verified review, that requires a
deliberate, explicit, auditable action with its own evidence trail — not an automatic mapping.
No such feature exists today.

## 2. Supported sources and their real verification status

| Source | `ImportSource` value | Built against | Verified against a real export? |
|---|---|---|---|
| Generic CSV | `csv` | A documented, self-describing column-alias scheme (this app's own format, tolerant of common header variants) | Yes — this is the universal fallback and is exercised by the largest share of the test suite, including a 10,000-row scale test |
| Judge.me | `judgeme` | Judge.me's real export format | **Yes** — verified against two real merchant exports (2,540 rows and a separate 265-row export), including real duplicate re-import and title-repair regressions found from actual export data, not invented fixtures |
| Loox | `loox` | Loox's own documented CSV import-template column spec | **No** — no real Loox export file has been available to this project. Built against the documented template only |
| Stamped.io | `stamped` | Stamped's own documented CSV import-template column spec | **No** — same limitation as Loox |
| Ali Reviews | `alireviews` | Ali Reviews' documented CSV import template (`help.alireviews.io`) — quoted verbatim in `alireviews.server.ts`'s header comment | **No** — same limitation |
| Ryviu | `ryviu` | Not built | **N/A** — public documentation only confirms a partial column set (`product_handle`, `rating`, `photo_urls`, `created_at`) with no confirmed reviewer-name/content/email columns. Not enough to build a real importer without guessing — exactly what this pipeline exists to avoid. `IMPORT_SOURCES` marks it `available: false` |

**"Built against a documented spec, not yet verified against a live export" is not the same as
"broken" or "fake."** Loox/Stamped/Ali Reviews all parse correctly against synthetic fixtures
shaped exactly like their published templates, have real adapter code (not stubs), and are
covered by real unit tests. What's missing is proof a real merchant's actual raw export file
matches that published template byte-for-byte — the same gap that caused the original Judge.me
importer to silently reject every row until it was rebuilt against a real sample (see
`DECISIONS.md`'s 2026-08-07 entry). If a real export sample becomes available for any of the
three, re-verify against it before calling that adapter production-verified, the same way
Judge.me was.

## 3. Product matching — never guess

`ProductMatcher` (`app/services/importers/productMatcher.server.ts`) tries, in order:
`shopify_product_id` → `variant_id` (live Admin API) → `handle` → `url` → `slug` → `sku` (live
Admin API) → exact title → normalized title → fuzzy title (token-overlap, 0.75 similarity
floor).

A row lands in exactly one of three buckets, always:
- **Matched** — one confident candidate. Imported.
- **Unmatched** — zero candidates. Reported in `missingProducts`, never imported, never
  attached to a guessed product.
- **Ambiguous** — two or more equally plausible candidates (an exact/normalized-title
  collision, or a fuzzy match where the top two scores are within 0.05 of each other).
  Reported in `ambiguousProducts` with every candidate's product ID, never auto-resolved to
  either. A merchant must add a more specific column (handle/SKU/ID) or resolve manually.

A fuzzy match that *isn't* ambiguous still generates a `warnings` entry so a merchant can
spot-check it — fuzzy matching is a last resort, not a silent default.

## 4. Customer matching — there is nothing to fabricate

The `Review` model has no `customerId`/`shopifyCustomerId` column at all — reviewer identity is
always free-text (`reviewerName`, `reviewerEmail`), for both organic and imported reviews. The
import pipeline never calls the Shopify Admin API for a customer lookup (the `admin` context
passed into `importRow` is used exclusively for the two live product-matching tiers). An
imported row's email is stored exactly as the source provided it, or left `null` if the source
provided none — never invented, never used to search for or attach a real Shopify customer
record. See `reviewImportExport.server.test.ts`'s "conservative customer matching" describe
block.

## 5. Publication state — always a merchant choice

`PublicationMode` (`app/services/importers/types.ts`) has three values, chosen in the import
wizard before any row is committed:

- **`preserve`** (default) — trust each row's own status column where the source provides one
  (`approved`/`published`/a truthy value → published immediately; `pending`/`rejected`/anything
  else → held for moderation). This is the only mode that varies per row.
- **`approved`** — publish every row in the file immediately, overriding whatever the source
  claims.
- **`pending`** — hold every row in the file for moderation, overriding whatever the source
  claims.

Nothing is ever auto-published without this choice being made — `preserve` is itself a shown,
selected default, not a silent fallback bypassing the decision.

## 6. Duplicate protection

Two independent layers:
1. **Application-level check-before-create** (`findExistingReview`) — matches on a stable
   source ID (`externalId`, scoped by `importSource` — an ID string is only unique within its
   own source's ID space) when the source provides one, falling back to a
   `(productId, reviewerName, content)` fingerprint when it doesn't (Loox/Stamped/Ali Reviews
   today).
2. **DB-level unique constraint** (`@@unique([storeId, importSource, externalId])`) — a real
   Postgres constraint as defense-in-depth against the race condition a check-then-insert always
   leaves open (two concurrent imports of the same file). Postgres treats every `NULL` as
   distinct, so this never blocks organic reviews (`importSource` always `null`) or any source
   with no per-row ID. A constraint violation (`P2002`) is caught and reported as an ordinary
   duplicate, never a hard row failure.

A narrow, explicit repair path exists: if a duplicate's *existing* row has no title and the
re-imported row does, the title is backfilled (never overwriting a title that's already set —
including a merchant's own manual edit). Every other field on a duplicate is left untouched.

## 7. Media import — validate and reference, never fetch

Imported image URLs are validated (https-only, blocks loopback/private/link-local hosts
including the full RFC1918 range, requires a recognizable image extension) and stored as
references. **The import pipeline never downloads or fetches the URL itself** — this closes an
SSRF surface a naive "re-host every imported image" design would open, at the cost of the
imported image becoming unavailable if the source's CDN URL later goes offline. A skipped URL is
reported with its specific reason (`skippedMedia`), never silently dropped.

## 8. Reply import

`reply`/`repliedAt` flow through from any source that provides them, stored exactly as given.
A row with no reply data gets `reply: null, repliedAt: null` — never a fabricated reply, and
never a fabricated date for a reply that does have text but no timestamp.

## 9. Security — the file is untrusted input

- 25MB file-size cap, checked before any parsing.
- OWASP CSV/formula-injection mitigation on **export**: a cell value starting with `=`, `+`,
  `-`, `@`, tab, or CR gets a leading apostrophe so it can never execute as a spreadsheet formula
  when a merchant opens their own exported CSV.
- Every query is scoped to the authenticated store's own `storeId` — no cross-tenant import
  path exists.
- A dry run performs every real check (matching, validation, duplicate detection) against the
  live database and reports the exact outcome a real import would produce, but writes nothing —
  used for the mandatory "preview before commit" step.

## 10. Known, honest limitations

- Loox, Stamped, and Ali Reviews adapters are real code, not stubs, but are unverified against a
  live export (see §2) — do not describe them as "production-verified" until that changes.
- Ryviu has no adapter at all (insufficient public documentation).
- Large-import correctness (10,000 rows) is proven with a mocked-database unit test — a real
  Postgres run at that scale was intentionally not performed against any shared database (this
  project's own database-safety rules treat every real `DATABASE_URL` as production unless
  proven otherwise; see the project root `CLAUDE.md`). The mocked test's own linear-scan
  overhead means its wall-clock time is not a production throughput number, only a
  no-runaway-behavior check.
- There is no feature to promote a source-verified import into a real IMAGYN-verified review
  (see §1) — a merchant who wants a migrated review to carry real verification today would need
  to re-establish it the same way an organic review does.
