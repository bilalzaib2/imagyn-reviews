# Database Safety Policy

This project uses Railway PostgreSQL. This document is the permanent operating policy
for any AI-assisted or manual work that touches the database, established after a
production data-wipe incident (2026-07-21) caused by `prisma migrate diff
--shadow-database-url` being pointed at the live production connection string.

## Ground rules

1. **`DATABASE_URL` is PRODUCTION** unless explicitly proven otherwise for the current
   session (a genuinely separate local/disposable database, confirmed by host).
2. **Production is READ ONLY by default.** No command that can write, alter, or drop
   data runs without explicit, per-instance approval — no standing approval, no
   "you already said yes earlier."
3. **Before any database command**, state:
   - Environment detected (which host/db)
   - Whether the command is READ ONLY or WRITE
   - If WRITE: exactly what it will change and the risk
   - Then wait for explicit confirmation before running it.
4. READ operations (`SELECT`, `\dt`, `\d`, read-only `prisma studio` browsing) may run
   freely without asking.

## Never run without explicit approval

- `prisma migrate`, `prisma migrate dev`, `prisma migrate deploy`, `prisma migrate reset`
- `prisma db push`
- `prisma db execute`
- `prisma db seed`
- `prisma migrate diff --shadow-database-url` — **never** point this at anything but a
  verified disposable/local database. This exact command wiped production data once.
- Raw `DROP`, `DELETE`, `TRUNCATE`, `ALTER`, `CREATE DATABASE`, or any other
  schema/data-mutating SQL

## Why this exists

`prisma migrate diff --shadow-database-url <url>` treats `<url>` as disposable scratch
space — Prisma resets it to replay migration history and compute a diff. It was pointed
at the live Railway production database as a workaround for `prisma migrate dev` failing
in a non-interactive shell. Result: `Review`, `Product`, `Store`, `ReviewMedia`, `Widget`,
`Appearance` were all emptied, and the `_prisma_migrations` table itself was destroyed,
with no confirmation step in between.

## Safe alternatives when `prisma migrate dev` fails non-interactively

- Ask the operator to run the interactive command themselves in their own terminal, or
- Point any shadow-database operation at a genuinely separate local/disposable Postgres
  instance, never the real `DATABASE_URL`, or
- Hand-write the migration SQL for human review instead of auto-generating it against a
  live connection.

## Workflow this protects

- **Development seed strategy, backup strategy, and production guardrails** are tracked
  separately as recommendations pending implementation — see the recovery report /
  project notes for the current proposal. This file covers the non-negotiable safety
  rules only.
