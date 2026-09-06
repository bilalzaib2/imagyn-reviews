# Access Control

What actually controls access to Imagyn Reviews' systems and data today, distinguishing what
is verified from the codebase/git history versus what requires checking the actual account
settings on each platform. Items marked **[VERIFY]** are real gaps in what this document can
confirm from inside the repository — they need to be checked directly in each platform's own
settings, not assumed.

## Merchant / customer access — verified, enforced in code

Merchant staff never authenticate against anything this app controls directly. Access is
entirely Shopify's own OAuth (`app/shopify.server.ts`'s `shopifyApp(...)`) — Shopify issues
the session, Shopify enforces whatever staff-permission model the merchant has configured on
their own store. This app has no username/password login, no separate staff-role system, and
no admin backdoor of its own (confirmed by grep across the codebase — no `basicAuth`,
`ADMIN_PASSWORD`, or similar pattern exists anywhere).

Every merchant-facing query in the codebase is scoped to the authenticated session's own
`storeId` — extensively covered by "cross-tenant isolation" tests across
`review.server.test.ts`, `review-request.server.test.ts`, and others, which specifically
assert one store's session can never read or mutate another store's data.

## Staff account password strength

Confirmed directly with the operator (2026-09-06): the two accounts that gate access to the
systems holding protected customer data — the GitHub account (`bilalzaib2`) that controls
this repository, and the Railway account (personal workspace "Muhammad Bilal Zaib's
Projects") that controls the production database and deploy pipeline — use unique passwords
meeting Shopify's own "strong password" description (minimum length plus a mixture of
numbers, letters, and special characters). This is currently a single-operator fact, not an
enforced organizational policy with tooling behind it (there is no password manager mandate,
no rotation schedule, no automated complexity check) — it reflects what the operator actually
does today, not an aspirational claim. Whether 2FA is additionally enabled on these same two
accounts remains a separate, unverified `[VERIFY]` item below — password strength and
two-factor authentication are tracked as distinct facts here deliberately, since one doesn't
imply the other.

## Repository access — GitHub

Repository: `bilalzaib2/imagyn-reviews` (private, per the remote used throughout this
project's git history).

- **Contributors to date:** every commit in this repository's history is authored by one
  person (verified via `git log --format='%an <%ae>'`), under a small number of git-config
  identity variants (`Bilal Zaib <bilal.zaib@outlook.com>`, `bilalzaib2` on GitHub). There is
  no evidence in git history of any other contributor.
- **[VERIFY]** Repository visibility (private vs. public), branch protection rules on `main`,
  required reviews, and whether 2FA is enforced on the GitHub account/organization — none of
  this is visible from inside the repository itself. Confirm directly in GitHub's own
  repository/organization settings.
- **[VERIFY]** Whether any GitHub Actions, webhooks, or third-party integrations have been
  granted repository access — check GitHub → Settings → Integrations.

## Production infrastructure access — Railway

Project: `exemplary-clarity`, service `imagyn-reviews`, region `sfo` (per
`docs/OPERATIONS.md`'s infrastructure map).

- **What the app itself proves:** the production `DATABASE_URL` uses Railway's internal
  private-network hostname (`.railway.internal`), not a publicly reachable database endpoint
  — confirmed by checking for that hostname pattern's presence in the live environment
  variable (value not printed). This means the database is not directly reachable from the
  public internet independent of the app.
- **Workspace type confirmed:** `railway status` reports the workspace as "Muhammad Bilal
  Zaib's Projects" — a personal workspace, not a team workspace with multiple members. This
  is consistent with the single-operator access picture above, though it doesn't substitute
  for checking the project's own Members page directly.
- **[VERIFY]** Whether 2FA is enforced on the Railway account — not visible from the
  repository or the CLI's own output. Confirm in Railway's own account settings.
- **[VERIFY]** Whether the production Postgres database is reachable from any IP outside
  Railway's own network (e.g., via `DATABASE_PUBLIC_URL`, which `docs/OPERATIONS.md`
  documents as existing and being "used in local `.env`" — this is itself a real exposure
  surface worth reviewing, see `DATABASE_SAFETY.md`'s test/production separation section).

## Email provider access — Resend

- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are confirmed set in the production Railway
  environment (checked for presence only; values were never printed or logged).
- **[VERIFY]** Who has access to the Resend account/dashboard, whether 2FA is enforced there,
  and what the account's own team-member list looks like — this is entirely outside the
  codebase.

## Shopify Partner Dashboard access

- This is where the app's own configuration (API credentials, webhook subscriptions, the
  Protected Customer Data approval this audit is in service of) is managed.
- **[VERIFY]** Who has access to the Partner organization, what role each person has, and
  whether 2FA is enforced — this is entirely a Shopify Partner Dashboard setting, invisible
  from this repository.

## Database access — direct (psql / Prisma Studio)

- `DATABASE_SAFETY.md` documents the operating policy for anyone (human or AI-assisted)
  running commands against the database: read operations are unrestricted, every
  write-capable command requires explicit per-instance approval, and `DATABASE_URL` is
  treated as production by default.
- **[VERIFY]** How many people currently have the actual production `DATABASE_URL` value
  (e.g., in a local `.env`, a password manager, or shared some other way), and whether that
  set of people matches who should have it. This document cannot enumerate that from the
  repository — it can only state the policy that's supposed to govern it.

## What this document deliberately does not claim

- It does not claim a formal RBAC system, SSO, or enterprise access-management tooling exists
  — none does, and none is implied here.
- It does not invent team members, roles, or account settings that can't be verified from the
  codebase. Every **[VERIFY]** item above is a real gap between "what the code proves" and
  "what the questionnaire is actually asking," and should be checked directly rather than
  assumed one way or the other.
