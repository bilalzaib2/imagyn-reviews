// Verifies that the LOCAL development store's Shopify offline session is real, current and
// wide enough to exercise the features that need the Admin API — before any integration test
// trusts it.
//
// WHY THIS EXISTS
//
// On 2026-11-10 the local offline session for verveonline.myshopify.com was found to be
// rejected by Shopify with a flat 401 ("Invalid API key or access token"). Three separate
// facts had to be established by hand to understand it, and each one is a question this
// script now answers in one run:
//
//   1. Was the token merely stale in OUR database, or actually revoked by Shopify? Only a real
//      Admin API round-trip distinguishes those, and they need completely different fixes.
//   2. Is the session's GRANTED scope set the one the app now requests? It was not — the
//      stored session predated write_discounts, read_fulfillments and read_legal_policies, so
//      a token could come back "valid" and still fail every Coupons call (see
//      scopes.config.test.ts for the .env drift that caused it).
//   3. Is the store a development store? Every integration test in this project is only
//      permitted against one, so that has to be proven from Shopify's own data
//      (shop.plan.partnerDevelopment), never assumed from the store's name.
//
// It is READ-ONLY. It performs no mutation, creates no discount, sends no email, and writes
// nothing to the database. Run it immediately after re-authenticating, and again before any
// session-dependent integration test.
//
// It refuses to run against a non-local database, because its whole purpose is to validate a
// DEVELOPMENT session and the same query shapes against production would read live merchant
// data for no reason.
//
// Access tokens are never printed. Only a length and a format prefix are reported, which is
// enough to tell "present and shaped like an Admin token" from "missing" or "truncated".
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Read from shopify.app.toml rather than importing app/shopify.server.ts, which is TypeScript
// and pulls in the whole Prisma/Shopify app graph for one string. The toml's api_version and
// the app's ApiVersion enum are already pinned to each other by
// app/services/apiVersions.config.test.ts, so this cannot silently diverge from what the app
// itself calls.
const apiVersion = readFileSync(join(REPO_ROOT, "shopify.app.toml"), "utf8").match(
  /^api_version = "(.+)"$/m,
)?.[1];
if (!apiVersion) throw new Error("Could not read api_version from shopify.app.toml");

const SHOP = process.argv[2] || "verveonline.myshopify.com";

// Kept in sync with shopify.app.toml by app/services/scopes.config.test.ts — this reads the
// same env var the running app passes to shopifyApp(), so it checks what OAuth will actually
// have requested rather than a second hand-maintained list.
const REQUESTED_SCOPES = (process.env.SCOPES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const results = [];
function record(ok, label, detail) {
  results.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL || "";
  const host = url.match(/@([^:/?]+)/)?.[1] ?? "";
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    console.error(
      `Refusing to run: DATABASE_URL points at "${host || "an unparseable host"}", not a local database.\n` +
        "This script validates a development session only. Point DATABASE_URL at the local dev\n" +
        "database and run it again.",
    );
    process.exit(2);
  }
  console.log(`Database: local (${host})\n`);
}

async function graphql(token, query) {
  const res = await fetch(`https://${SHOP}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  assertLocalDatabase();

  const prisma = new PrismaClient();
  const session = await prisma.session.findUnique({ where: { id: `offline_${SHOP}` } });
  await prisma.$disconnect();

  if (!session) {
    record(false, "offline session exists", `no row "offline_${SHOP}" — the app has never completed OAuth against this database`);
    return finish();
  }
  record(true, "offline session exists", `shop=${session.shop} isOnline=${session.isOnline}`);
  record(
    session.accessToken?.startsWith("shpat_") ?? false,
    "token is shaped like an Admin API token",
    `prefix=${session.accessToken?.slice(0, 6) ?? "none"}… length=${session.accessToken?.length ?? 0}`,
  );

  // `expiringOfflineAccessTokens` is enabled in app/shopify.server.ts, so an offline token
  // legitimately carries an expiry and legitimately needs refreshing — a past one here is the
  // expected, documented reason the app would start failing, not a corrupted row.
  const expired = session.expires ? session.expires.getTime() < Date.now() : false;
  record(
    !expired,
    "token has not expired locally",
    session.expires ? `expires=${session.expires.toISOString()}` : "no expiry recorded",
  );

  const granted = (session.scope || "").split(",").map((s) => s.trim()).filter(Boolean);

  // A granted write scope carries its read counterpart — Shopify's own access-scope guide says
  // so explicitly, and warns about this exact misreading: "a granted write scope carries its
  // read counterpart, so don't read an absent read_ handle as a missing permission."
  // Comparing the two strings as literal sets gets this wrong, and gets it wrong in the worst
  // direction: it reports a healthy session as incomplete. The real stored session proved it —
  // granted held write_files but not read_files, and this check called read_files "missing"
  // while every Files API call the app makes was in fact authorised. Left as a literal
  // comparison it would have failed a good re-authorisation at 5/6 and blocked the whole
  // integration-test queue on a permission that was never actually absent.
  const isCoveredBy = (scope, held) => held.includes(scope)
    || (scope.startsWith("read_") && held.includes(`write_${scope.slice("read_".length)}`));

  const missing = REQUESTED_SCOPES.filter((s) => !isCoveredBy(s, granted));
  const impliedOnly = REQUESTED_SCOPES.filter((s) => !granted.includes(s) && isCoveredBy(s, granted));

  record(
    REQUESTED_SCOPES.length > 0,
    "SCOPES is configured for this environment",
    `${REQUESTED_SCOPES.length} requested`,
  );
  record(
    missing.length === 0,
    "granted scopes cover every requested scope",
    missing.length
      ? `missing: ${missing.join(", ")}`
      : impliedOnly.length
        ? `${granted.length} granted; ${impliedOnly.join(", ")} covered by the write scope`
        : `${granted.length} granted`,
  );

  // The live round-trip. Everything above is readable from our own database and can be true
  // of a token Shopify has already revoked.
  const probe = await graphql(
    session.accessToken,
    "{ shop { name myshopifyDomain primaryDomain { host } plan { displayName partnerDevelopment shopifyPlus } } }",
  );
  if (probe.status !== 200 || probe.body?.errors) {
    record(
      false,
      "Shopify accepts the token",
      `HTTP ${probe.status} ${JSON.stringify(probe.body?.errors ?? probe.body).slice(0, 200)}`,
    );
    return finish();
  }
  const shop = probe.body.data.shop;
  record(true, "Shopify accepts the token", `HTTP 200`);
  record(
    shop.myshopifyDomain === SHOP,
    "the token belongs to the store we targeted",
    `token resolves to ${shop.myshopifyDomain} (“${shop.name}”, primary domain ${shop.primaryDomain?.host})`,
  );
  record(
    shop.plan.partnerDevelopment === true,
    "the store is a development store",
    `plan="${shop.plan.displayName}" partnerDevelopment=${shop.plan.partnerDevelopment} shopifyPlus=${shop.plan.shopifyPlus}`,
  );

  // One read per scope that a later integration test depends on, so a missing permission is
  // reported here by name instead of surfacing as a mid-test failure. Counts only; no record
  // contents are read or printed.
  const reads = [
    ["read_orders", "{ orders(first: 1) { nodes { id } } }"],
    ["read_customers", "{ customers(first: 1) { nodes { id } } }"],
    ["write_discounts", "{ codeDiscountNodes(first: 1) { nodes { id } } }"],
    ["read_files", "{ files(first: 1) { nodes { id } } }"],
    ["read_legal_policies", "{ shop { shopPolicies { type } } }"],
  ];
  for (const [scope, query] of reads) {
    const { status, body } = await graphql(session.accessToken, query);
    const denied = body?.errors?.some?.((e) => /access denied|access scope/i.test(e.message ?? ""));
    record(
      status === 200 && !denied,
      `a read requiring ${scope} succeeds`,
      denied ? body.errors.map((e) => e.message).join("; ").slice(0, 160) : `HTTP ${status}`,
    );
  }

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("\nThis session is NOT usable for integration tests. Unresolved:");
    for (const f of failed) console.log(`  - ${f.label}${f.detail ? ` (${f.detail})` : ""}`);
    process.exitCode = 1;
  } else {
    console.log("Session verified: safe to run development-store integration tests.");
  }
}

await main();
