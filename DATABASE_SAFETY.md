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

`DATABASE_URL` had historically been the **same production Railway database** for both the
deployed app and local development (confirmed in `docs/OPERATIONS.md`'s infrastructure map:
`DATABASE_PUBLIC_URL` — the external variant of the production connection string — "used in
local `.env`"). **As of 2026-09-08, local development uses a genuinely separate database —**
a local Postgres 16 instance (`imagyn_reviews_dev`, running via Homebrew's `postgresql@16`
service on `localhost:5432`; Docker was the originally-planned route but isn't installed in
this environment, so a native local Postgres instance was used instead — functionally
identical for this purpose: a real, separate host, not a container flavor). Verified empty
(0 stores, 0 reviews) before use, and brought current with all 20 migrations via a plain
`prisma migrate deploy` run with `DATABASE_URL` overridden to point at it only for that one
command — production's own `DATABASE_URL` was never read or touched by that command.

- **Automated tests never touch this at all** — every `*.test.ts` file either mocks
  `../db.server` directly or doesn't import anything that reaches Prisma (verified across
  all 31 test files as of 2026-09). `npm test` cannot write to any database, production or
  otherwise, by construction.
- **`prisma/seed.js` has a hard runtime guard**: it refuses to run (exits non-zero before
  ever calling Prisma) if `NODE_ENV=production` or `RAILWAY_ENVIRONMENT` is set — both are
  real signals confirmed present in this app's actual production environment, not guessed.
  Verified both ways this session: it correctly refuses when either signal is set, and
  correctly proceeds against the local dev database when neither is set. (There is also a
  second, independent, pre-existing confirmation gate in the same script —
  `CONFIRM_SEED_RESET=yes` — required before it resets/reseeds any database at all,
  regardless of which one.)
- **Local `.env`'s `DATABASE_URL` now points at the local dev database**, not production.
  Anyone else working on this app locally still needs to do the same — provision their own
  local Postgres (or point at this same one if working on the same machine) and update their
  own `.env`; this is a per-developer step no guard can force automatically.

## Workflow this protects

- **Backup strategy** is tracked separately as a recommendation pending implementation —
  it depends on Railway's own managed-Postgres backup capabilities, which are
  infrastructure/account configuration, not something this repo's code controls.
