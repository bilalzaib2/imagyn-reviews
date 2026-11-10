import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A migration that rewrites existing rows is a different kind of change from one that adds
// structure, and it deserves a different level of scrutiny — because for a merchant-facing
// setting it is usually irreversible in practice. Prisma has no down-migrations, and a value
// that was overwritten can only be restored if it was recorded somewhere first. Most settings
// in this schema are controls, not consent records, so they are not recorded anywhere.
//
// This is not hypothetical. `20261107213014_public_network_opt_in` originally shipped with:
//
//     UPDATE "Store" SET "publicNetworkEnabled" = false WHERE "publicNetworkEnabled" = true;
//
// which would have switched public review-network sharing off for every existing merchant,
// including merchants who had deliberately turned it on, with no way to put it back. It was
// caught in a pre-deployment audit before it ever reached production and the UPDATE was
// removed; the column DEFAULT still changes, so new stores get the secure default.
//
// These tests make that a standing rule rather than a thing someone has to notice again.
const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/**
 * Migrations that mutate rows and are ALREADY APPLIED IN PRODUCTION.
 *
 * Rewriting an applied migration is its own hazard — Prisma records a checksum per migration
 * and a deploy against a database that already ran the old text will refuse to continue. So
 * these stay exactly as they are, and are listed here to be acknowledged rather than silently
 * skipped. Nothing may be added to this list: a new entry would mean a row-mutating migration
 * reached production, which is the thing the rule exists to prevent.
 */
const APPLIED_ROW_MUTATING_MIGRATIONS = new Set([
  // Shipped before this rule existed. Copies one boolean column onto another on the Store
  // table as part of splitting one AI-summary display flag into two.
  "20260915110515_rescope_ai_summary_display_flags",
]);

/**
 * Migrations that drop a column or table and are ALREADY APPLIED IN PRODUCTION. Closed, for
 * the same reason as the list above.
 */
const APPLIED_DESTRUCTIVE_MIGRATIONS = new Set([
  // Drops Store.aiSummaryOnWidgetEnabled, immediately after copying its value to the column
  // that replaced it.
  "20260915110515_rescope_ai_summary_display_flags",
]);

const ROW_MUTATING = /^\s*(UPDATE|DELETE\s+FROM|TRUNCATE)\s/im;
const DESTRUCTIVE_SCHEMA = /^\s*ALTER\s+TABLE\s+"?\w+"?\s+DROP\s+COLUMN|^\s*DROP\s+TABLE/im;

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Comments explain intent and routinely quote SQL; only executable statements count. */
function executableSql(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("migrations do not rewrite existing merchant data", () => {
  const names = migrationNames();

  it("finds the migration directory", () => {
    expect(names.length).toBeGreaterThan(40);
  });

  it.each(names)("%s does not UPDATE, DELETE or TRUNCATE rows", (name) => {
    if (APPLIED_ROW_MUTATING_MIGRATIONS.has(name)) return;

    const sql = executableSql(name);
    const match = sql.match(ROW_MUTATING);

    expect(
      match?.[0]?.trim(),
      `${name} rewrites existing rows. Prisma has no down-migrations, and a merchant setting ` +
        `overwritten here usually cannot be restored, because these columns are controls rather ` +
        `than consent records. Add structure and let the application decide, or bring the case ` +
        `to the owner before shipping it.`,
    ).toBeUndefined();
  });

  it.each(names)("%s does not drop a column or table", (name) => {
    // Same reasoning as the row-mutating list: already in production, so it is history rather
    // than a decision still open. 20260915110515 drops Store.aiSummaryOnWidgetEnabled in the
    // same migration that copies its value onto the replacement column.
    if (APPLIED_DESTRUCTIVE_MIGRATIONS.has(name)) return;

    const match = executableSql(name).match(DESTRUCTIVE_SCHEMA);

    expect(
      match?.[0]?.trim(),
      `${name} drops a column or table, which destroys data the moment it deploys.`,
    ).toBeUndefined();
  });

  it("does not grow either list of already-applied exceptions", () => {
    // A new entry in either set means a destructive migration reached production, which is the
    // thing these rules exist to prevent. Both lists are historical and closed.
    expect(APPLIED_ROW_MUTATING_MIGRATIONS.size).toBe(1);
    expect(APPLIED_DESTRUCTIVE_MIGRATIONS.size).toBe(1);
  });
});

describe("public_network_opt_in keeps existing merchants' preference", () => {
  const NAME = "20261107213014_public_network_opt_in";

  it("changes the column default so new stores are private", () => {
    expect(executableSql(NAME)).toMatch(/ALTER COLUMN "publicNetworkEnabled" SET DEFAULT false/);
  });

  it("does not touch a single existing Store row", () => {
    expect(executableSql(NAME)).not.toMatch(/UPDATE\s+"Store"/i);
  });

  it("has a rollback that is symmetrical and lossless", () => {
    const rollback = readFileSync(join(MIGRATIONS_DIR, NAME, "rollback.sql"), "utf8");

    expect(rollback).toMatch(/SET DEFAULT true/);
    // If the rollback had to restore row values, the migration was not safe to begin with.
    expect(rollback.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")).not.toMatch(/^\s*UPDATE/im);
  });
});

describe("every pending migration ships a rollback", () => {
  // The three not yet in production. A migration without a stated reversal is a migration
  // nobody has thought through reversing.
  it.each([
    "20261106204257_add_hide_reasons_and_questions",
    "20261106210057_add_review_archive",
    "20261107213014_public_network_opt_in",
  ])("%s has a rollback.sql", (name) => {
    const files = readdirSync(join(MIGRATIONS_DIR, name));
    expect(files).toContain("rollback.sql");
  });
});
