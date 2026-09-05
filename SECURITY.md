# Security & Incident Response

Internal operational reference for Imagyn Reviews. This describes the process this team
actually follows, at the size this team actually is — it does not claim a formal enterprise
security program, a dedicated security team, or a SOC-style process that doesn't exist here.
For infrastructure/data topology, see [`docs/OPERATIONS.md`](docs/OPERATIONS.md); for what
personal data is collected and retained, see [`docs/DATA_RETENTION_POLICY.md`](docs/DATA_RETENTION_POLICY.md)
and [`DATABASE_SAFETY.md`](DATABASE_SAFETY.md); for who has access to what, see
[`docs/ACCESS_CONTROL.md`](docs/ACCESS_CONTROL.md).

## What counts as a security incident here

Any of the following:

- Unauthorized access to the production database, Railway project, GitHub repository,
  Resend account, or Shopify Partner Dashboard.
- Evidence that merchant or customer personal data (reviewer name/email, review-request
  email/name, order identifiers) was accessed, exported, or exposed by anyone other than the
  merchant it belongs to or this app's own operator.
- A credential (Shopify API secret, `RESEND_API_KEY`, `DATABASE_URL`, GitHub token) being
  exposed — committed to a public repository, pasted somewhere public, or found in a leaked
  secrets scan.
- A vulnerability report (from Shopify, a merchant, a security researcher, or discovered
  internally) describing a way to access another store's data, bypass authentication, or
  execute unintended code.
- Unexplained data loss or corruption in the production database.
- A dependency with a disclosed critical/high CVE that this app actually uses in a reachable
  code path.

**Not** automatically an incident: a failed login attempt, a single bounced/undeliverable
email, an expected `410` from an expired review-link token, or a Sentry-style error report
with no evidence of unauthorized access — these are normal operational noise, triaged as
bugs, not incidents, unless they reveal one of the categories above.

## Who is responsible

This is currently a single-operator project (Imagyn Studios). The person who discovers or is
notified of a suspected incident is responsible for driving the response below — there is no
separate security team to hand this off to. If external help is needed (e.g., Shopify's own
Partner support, Railway support, Resend support), engaging them is part of containment, not
a separate step.

## Initial containment steps (in order)

1. **Confirm it's real** before taking disruptive action — check Railway logs
   (`railway logs`), the Shopify Partner Dashboard's own security notices, and Resend's
   dashboard for anything matching the report.
2. **Stop the bleeding, not the whole app.** Prefer the narrowest effective containment:
   - A single leaked credential → rotate that credential (see below), don't take the app
     offline.
   - Evidence of a specific exploitable endpoint → if it can be disabled without breaking
     unrelated functionality, disable it (e.g., via a feature flag, same pattern as
     `ORDER_AUTOMATION_ENABLED`) while a fix is prepared.
   - Active, ongoing unauthorized database access → this is the one case that may justify
     rotating `DATABASE_URL` / restricting Railway network access even if it causes downtime.
3. **Do not delete evidence.** Don't truncate logs, don't drop the affected table, don't
   force-push over suspicious commits — preserve everything until the investigation below is
   at least started.

## Credential rotation

If a credential is confirmed or suspected leaked:

| Credential | Where to rotate |
|---|---|
| `SHOPIFY_API_SECRET` | Shopify Partner Dashboard → app settings → regenerate; update Railway env var |
| `RESEND_API_KEY` | Resend dashboard → API Keys → revoke and issue a new one; update Railway env var |
| `RESEND_WEBHOOK_SECRET` | Resend dashboard → webhook settings → regenerate; update Railway env var |
| `DATABASE_URL` credentials | Railway project → Postgres service → reset password/connection string; update every service reading it |
| GitHub access (personal access tokens, deploy keys) | GitHub → Settings → Developer settings → revoke the specific token |
| Railway account/team access | Railway → project settings → Members → remove the affected member/session |

After rotating anything, **redeploy** so the running process picks up the new value —
Railway does not hot-reload environment variables into an already-running container.

## Investigation / log preservation

- Pull the relevant window of `railway logs` before it rolls off retention and save it
  outside Railway (a local file, not committed to the repo) for the duration of the
  investigation.
- If the `AuditLog` table (see `app/services/auditLog.server.ts`) has relevant rows for the
  incident window, export them — they're the one place this app records *meaningful* access
  to protected customer data (GDPR webhook events, bulk CSV exports, the retention purge)
  with actor/action/timestamp/success, without the underlying PII.
- Check `_prisma_migrations` and recent migration history if data corruption is suspected —
  see `docs/OPERATIONS.md`'s recovery section for how to tell a legitimate migration from
  unexpected schema drift.
- Do not restore from a backup or reset any data until the scope of the incident is
  understood — a premature reset can destroy the evidence needed to understand what actually
  happened.

## Shopify notification / escalation

- If the incident involves Shopify merchant or customer data, review Shopify's Partner
  Program Agreement / Acceptable Use Policy for any mandatory disclosure timeline that
  applies, and follow it. (This document does not restate Shopify's own legal terms — read
  the current version at the time of an actual incident, since terms can change.)
- If the incident affects the app's Protected Customer Data approval status or scope
  usage, be prepared to disclose this proactively in any future approval
  correspondence rather than let it surface independently.

## Customer / merchant communication

- If a specific merchant's data was affected, notify that merchant directly, with: what
  happened, what data was involved, what's been done about it, and what (if anything) they
  need to do.
- If customer (not merchant) personal data was affected, the affected merchant is the
  first point of contact — they own the customer relationship on Shopify's platform. Support
  them in fulfilling any obligation they have to their own customers, rather than contacting
  the merchant's customers directly.
- Be factual and specific. Don't minimize, and don't speculate about scope beyond what's
  actually been confirmed.

## Post-incident review

After any real incident (not near-misses that turned out to be nothing):

1. Write down what happened, in what order, in plain language — a short incident note, not a
   formal report template.
2. Identify the root cause, not just the triggering event.
3. Identify one or two concrete changes (a code fix, a new guard like `prisma/seed.js`'s
   production check, a documentation update, a process change) that would have prevented it
   or caught it sooner.
4. Actually make those changes — an incident review that doesn't result in a real follow-up
   change is a wasted incident.
5. If the incident is the kind covered by [`DATABASE_SAFETY.md`](DATABASE_SAFETY.md) or
   [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)'s conventions, add it there so the
   same investigation is never repeated from scratch.

## What this document is not

This is not a claim of ISO 27001, SOC 2, or any formal certified security program. No
third-party security audit has been performed on this app (see the compliance audit this
document accompanies). This is a real, honest description of how a small, single-operator
team would actually respond — not aspirational process theater.
