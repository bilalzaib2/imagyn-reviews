# Data Loss Prevention (DLP) — Policy and Technical Controls

Minimum-realistic DLP for a small, single-operator Shopify app that handles reviewer/customer
Name and Email only — not an enterprise DLP program, and this document does not claim to be
one. Split explicitly into **technical controls** (code, verifiable in the repo) and
**policy** (rules that depend on people following them, not enforceable by code alone) per
the requirement this document satisfies.

## Mapping to Shopify's own definition

Shopify defines this requirement (Protected Customer Data questionnaire, Q12) as: *"A
combination of technical controls, policies, and standards that protect an organization from
the possibility of a bad actor extracting data for nefarious purposes."* Read literally,
against what actually exists:

- **Technical controls** — tenant isolation (can't reach another store's data at all), a
  per-call export cap (bounds one extraction), a per-store hourly export rate limit (bounds
  repeated extraction attempts from defeating that cap), audit logging (every meaningful
  access is recorded, including blocked attempts), and a 90-day retention purge (reduces how
  much personal data exists to extract in the first place, over time). Five independent,
  real, tested controls — not one.
- **Policies** — the access rules below (who may access raw data, for what purpose, and the
  explicit prohibition on copying it outside the app except for authorized support).
- **Standards** — the consistent pattern applied across every control: least-privilege by
  default (storeId-scoped), bounded rather than unbounded (row caps, rate limits, retention
  windows), and audited rather than silent.

This is judged sufficient for a small, single-operator app of this data sensitivity (Name and
Email only, never payment/health/government-ID data). It is explicitly not equivalent to an
enterprise DLP program (no DLP scanning product, no CASB, no SIEM) — that would be inventing
a requirement Shopify's own wording doesn't ask for at this scale.

## Technical controls that exist today

| Control | What it does | Where |
|---|---|---|
| Tenant isolation | Every query is scoped to the authenticated session's own `storeId` — one store can never read or mutate another's data | Enforced throughout `app/services/review.server.ts`, `app/services/review-request.server.ts`; extensively covered by "cross-tenant isolation" tests |
| Audit logging | Records every GDPR compliance-webhook event and every bulk CSV export (actor, action, resource category, row count, success/failure) — never the underlying email/name/content | `app/services/auditLog.server.ts`, wired into `app/routes/webhooks.compliance.tsx` and `app/services/reviewImportExport.server.ts` |
| Export cap | `exportReviewsToCsv` cannot return more than `MAX_EXPORT_ROWS` (10,000) rows in a single call, regardless of how many reviews a store actually has — bounds the maximum personal data (reviewer name/email) extractable in one request | `app/services/reviewImportExport.server.ts` |
| Export rate limit | A store cannot export more than `EXPORT_RATE_LIMIT_MAX` (10) times per rolling hour — closes the gap the per-call cap alone leaves open (repeating the call to defeat the cap in aggregate). Checked against the existing `AuditLog` table itself, no new dependency. A blocked attempt is still audit-logged (`success: false`), so it's visible, not silently dropped | `app/services/reviewImportExport.server.ts` (`ExportRateLimitError`); surfaced as HTTP 429 in `app/routes/app.reviews.export.tsx` |
| Consent/suppression enforcement | An opted-out email is checked and blocked before every automated send, permanently (no retention purge applies to this table — see `docs/DATA_RETENTION_POLICY.md`) | `app/services/emailSuppression.server.ts` |
| Retention purge | Redacts `ReviewRequest.email`/`name` 90 days after a request goes terminal, bounded, idempotent, audited | `app/services/review-request.server.ts`'s `purgeStaleContactInfo`, scheduled via `app/services/reviewRequestScheduler.server.ts` |

## Platform-level controls (Railway, not this codebase)

These are real, but external — this document does not claim to control or fully verify them:

- Network isolation of the production database (confirmed: `DATABASE_URL` resolves to
  Railway's internal private-network hostname, not a publicly reachable endpoint).
- Whatever DDoS mitigation, disk encryption, and backup infrastructure Railway provides as
  the managed-Postgres operator — see `docs/ACCESS_CONTROL.md`'s `[VERIFY]` items; not
  something this app's code can prove or enforce.

## Policy — enforced by process, not code

**Who may access raw customer data (reviewer/customer name, email):**
- The app's own service code, scoped per-store, for the sole purpose of operating the
  features that require it (sending a review request, displaying a review to its own
  merchant, moderation, GDPR compliance actions).
- The operator of this app (currently a single person — see `docs/ACCESS_CONTROL.md`), when
  directly diagnosing a specific, real support issue that cannot be resolved without looking
  at the underlying data (e.g., a merchant reports a request never arrived).
- No one else. There is no other authorized access path.

**Legitimate purposes for accessing or exporting raw customer data:**
- Operating the review/request feature itself (this is the vast majority of all access, and
  it never leaves the database — the app reads it to do its job, nothing is "exported").
- Fulfilling a specific merchant support request that genuinely requires inspecting the
  underlying rows.
- Responding to a Shopify-mandated compliance event (`customers/data_request`,
  `customers/redact`, `shop/redact`) — already implemented, see
  `app/routes/webhooks.compliance.tsx`.
- A merchant's own deliberate use of the "Export CSV" feature for their own store's data —
  this is the merchant accessing their own data, not a third party.

**Handling rule:** raw customer data (name, email, or any export containing it) must not be
copied into a spreadsheet, pasted into a third-party tool (chat, ticketing system, AI
assistant, etc.), or saved to a personal device, **except** where a specific support case
genuinely requires it and only for the duration and scope that case requires. When that
happens, the copy must be deleted once the case is resolved, not retained "just in case."

**What this policy does not do:**
- It does not require a DLP scanning product, a CASB, or any third-party service — none is
  installed, and none is claimed to exist.
- It does not claim monitoring or alerting is in place beyond what's listed as a technical
  control above. If real-time alerting on unusual access patterns is wanted later, that is
  additional engineering work, not something this document should pretend already exists.
- It is not a substitute for the access-control verification items already tracked in
  `docs/ACCESS_CONTROL.md` (who actually has Railway/GitHub/Resend access today) — this
  policy states the *rule*; verifying it's actually being followed in practice is a separate,
  ongoing responsibility, not a one-time document.
