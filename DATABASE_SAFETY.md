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

## Test/production data separation

`DATABASE_URL` has historically been the **same production Railway database** for both the
deployed app and local development (confirmed in `docs/OPERATIONS.md`'s infrastructure map:
`DATABASE_PUBLIC_URL` — the external variant of the production connection string — "used in
local `.env`"). That is the actual root cause this section addresses, not a hypothetical.

- **Automated tests never touch this at all** — every `*.test.ts` file either mocks
  `../db.server` directly or doesn't import anything that reaches Prisma (verified across
  all 30 test files as of 2026-09). `npm test` cannot write to any database, production or
  otherwise, by construction.
- **`prisma/seed.js` has a hard runtime guard**: it refuses to run (exits non-zero before
  ever calling Prisma) if `NODE_ENV=production` or `RAILWAY_ENVIRONMENT` is set — both are
  real signals confirmed present in this app's actual production environment, not guessed.
  This stops the one command that both writes real rows and is trivial to run by hand.
- **Local development itself still requires a genuinely separate database** — the seed
  guard only stops one specific script; `shopify app dev`, a manually-run `prisma migrate
  dev`, or the app itself talking to Postgres in the ordinary course of local testing all
  still use whatever `DATABASE_URL` is in your `.env`. See `.env.example`'s `DATABASE_URL`
  comment for how to provision a real separate instance. **This part is an operational step
  each developer must take — a comment and a seed guard cannot force a human to actually
  change their local `.env`.**

## Workflow this protects

- **Backup strategy** is tracked separately as a recommendation pending implementation —
  it depends on Railway's own managed-Postgres backup capabilities, which are
  infrastructure/account configuration, not something this repo's code controls.
