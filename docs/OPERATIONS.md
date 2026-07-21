# OPERATIONS.md

Operational reference for Imagyn Reviews: infrastructure topology, health checks, and safety policies. For a specific past incident, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md). For day-to-day Shopify CLI usage, see [SHOPIFY_DEV_WORKFLOW.md](./SHOPIFY_DEV_WORKFLOW.md).

---

## Infrastructure map

| Component | Where | Notes |
|---|---|---|
| Web app (admin + storefront API routes) | Railway, service `imagyn-reviews`, project `exemplary-clarity`, region `sfo` | `react-router-serve`, deployed via `git push` to `main` |
| Database | Railway Postgres, database `railway` | Accessed via `DATABASE_URL` (internal) / `DATABASE_PUBLIC_URL` (external, used in local `.env`) |
| Theme app extension + app config | Shopify's platform | Deployed via `shopify app deploy` + `shopify app release` — independent of Railway, see [SHOPIFY_DEV_WORKFLOW.md](./SHOPIFY_DEV_WORKFLOW.md) |
| Dev store | `verveonline.myshopify.com` | The only store this app is currently installed on (confirmed via Dev Dashboard → Installs, single entry) |

Railway's `docker-start` script runs `npm run setup && npm run start`, where `setup` = `prisma generate && prisma migrate deploy`. This means **every Railway boot attempts a migration deploy** — if migration history is ever broken (see below), the app will fail to boot, not just fail to migrate.

## Health check — full sequence

Run these, in order, when something seems wrong and you don't yet know where:

```bash
# 1. Is the Railway service actually up?
railway status

# 2. Any exceptions in recent server logs?
railway logs -s imagyn-reviews --lines 100

# 3. Are migrations in a healthy state?
railway logs -s imagyn-reviews --lines 100 | grep -i "pending\|P3005\|migration"
# Or, read-only, direct to the DB:
psql "$DATABASE_URL" -c "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at;"

# 4. Does the app respond at all?
curl -s -o /dev/null -w "%{http_code}\n" https://imagyn-reviews-production.up.railway.app/

# 5. Is the EMBEDDED app actually pointed at Railway? (see SHOPIFY_DEV_WORKFLOW.md)
# Check the iframe src directly in the browser — this is the check that would
# have caught the 2026-07-21 incident in seconds instead of hours.
```

Steps 1–4 only prove the server is healthy. **Step 5 is the one that matters for "why is the embedded app not loading"** — a fully healthy server is not sufficient evidence that the embedded app resolves to it.

## Database safety

Full policy: [`DATABASE_SAFETY.md`](../DATABASE_SAFETY.md) (project root). Summary:

- `DATABASE_URL` is production unless proven otherwise for the current session.
- READ operations (`SELECT`, `\dt`, `\d`) are always fine.
- WRITE-capable commands (`prisma migrate *`, `db push`, `db execute`, `db seed`, raw DDL) require explicit, per-instance approval — every time.
- `prisma migrate diff --shadow-database-url` must never point at a real database. This exact command wiped production once (2026-07-19/20 incident) — the policy exists because of that.
- `prisma generate` is safe and requires no approval — it's local codegen from `schema.prisma`, never touches a database connection.

### Recovering a missing `_prisma_migrations` table

If `_prisma_migrations` is ever missing or out of sync with the actual schema (symptom: `prisma migrate deploy` fails with `P3005: database schema is not empty`), this is **baselining**, a documented Prisma workflow — not a reason to run `prisma db push` or `migrate reset`:

```bash
# For every migration whose effects ALREADY exist in the live schema
# (verify this first via \d on the affected tables — do not assume):
prisma migrate resolve --applied "<migration_name>"

# Only after every already-applied migration is resolved, deploy the
# genuinely-pending one(s):
prisma migrate deploy
```

`migrate resolve --applied` only inserts a bookkeeping row — it never executes the migration's SQL. Confirm this by checking `applied_steps_count: 0` in the resulting `_prisma_migrations` row.

## Deployment checklist

Before pushing to `main`:
- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean
- [ ] `npm run lint` — no *new* issues introduced (pre-existing issues in untouched files aren't blockers, but check)
- [ ] `git status` — confirm the diff matches what you intend to ship, nothing stray staged

After pushing:
- [ ] Confirm a new Railway deployment ID appears (`railway status`)
- [ ] Confirm clean startup in `railway logs` (no exceptions, "No pending migrations to apply" or a real, expected migration)
- [ ] If `shopify.app.toml` or `extensions/` changed: these are **not** live yet from the Railway push alone — see [SHOPIFY_DEV_WORKFLOW.md](./SHOPIFY_DEV_WORKFLOW.md) for the separate `shopify app deploy` step

## Known non-obvious facts worth not re-deriving

- **Theme app extension metafield access**: reading an app-owned metafield (`[product.metafields.app.*]` in `shopify.app.toml`) from *inside a theme app extension Liquid block* requires bracket notation — `product.metafields["$app"].key` — not the dot-notation (`product.metafields.app.key`) shown in Shopify's general metafields docs. The dot-notation silently resolves to nothing specifically inside theme app extension blocks. Verified empirically, deployed and confirmed live.
- **Deploying the web app and deploying extensions are fully decoupled.** A `git push` can be hours or days ahead of the last `shopify app deploy` with no error or warning from either side — check `shopify app versions list` if you're ever unsure what's actually live on Shopify's side versus what's committed.
- **`shopify app dev` mutates shared state beyond the local tunnel.** It's not a sandboxed, side-effect-free preview — it changes what a real merchant session resolves to for the targeted dev store until explicitly cleaned up (see [SHOPIFY_DEV_WORKFLOW.md](./SHOPIFY_DEV_WORKFLOW.md)).
