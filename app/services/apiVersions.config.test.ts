// Guards every declared Shopify API version in the repo against silently drifting out of
// Shopify's support window.
//
// This exists because of a real incident: extensions/customer-reviews-admin-block was pinned to
// api_version "2025-10", which left support on October 1, 2026. Nothing in the codebase noticed
// — the app built, typechecked, tested and deployed clean, and the only signal was an "Outdated
// extension API version" warning sitting in the Shopify Dev Dashboard where no CI run could see
// it. A version pin that expires on a calendar date needs a test that also knows about the
// calendar, otherwise it only fails in production.
//
// Shopify ships a stable version on the first day of each quarter and supports each one for a
// minimum of 12 months (https://shopify.dev/docs/api/admin-rest/usage/versioning), so "supported"
// is computable from the current date alone rather than needing a hardcoded list anyone has to
// remember to update.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { apiVersion as serverApiVersion } from "../shopify.server";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const QUARTER_MONTHS = [1, 4, 7, 10] as const;

/** "2026-07" -> the Date it was released (first day of that quarter, 00:00 UTC). */
function releaseDate(version: string): Date {
  const [year, month] = version.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

/** The stable version Shopify is serving right now — the most recent quarter already begun. */
function currentStableVersion(now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const quarter = [...QUARTER_MONTHS].reverse().find((m) => month >= m) ?? 10;
  const resolvedYear = month >= QUARTER_MONTHS[0] ? year : year - 1;
  return `${resolvedYear}-${String(quarter).padStart(2, "0")}`;
}

/**
 * Support ends 12 months after release. A version is supported while `now` is before that.
 * Deliberately exact rather than lenient: Shopify's 12 months is a *minimum*, and treating the
 * minimum as the deadline is the safe direction to be wrong in.
 */
function isSupported(version: string, now: Date): boolean {
  const end = releaseDate(version);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return now < end;
}

const API_VERSION_PATTERN = /^\d{4}-(01|04|07|10)$/;

function readTomlApiVersion(relativePath: string): string | null {
  const contents = readFileSync(join(REPO_ROOT, relativePath), "utf8");
  // Only a top-level, uncommented `api_version = "…"` — never a value inside a comment, which
  // shopify.app.toml has several of explaining past version decisions.
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    const match = /^api_version\s*=\s*"([^"]+)"/.exec(trimmed);
    if (match) return match[1];
  }
  return null;
}

// Every place in the repo that pins a Shopify API version. Add a row here whenever a new
// extension is scaffolded — a pin with no row is a pin nothing is watching.
const DECLARED_VERSIONS: Array<{ label: string; version: string | null }> = [
  { label: "shopify.app.toml [webhooks].api_version", version: readTomlApiVersion("shopify.app.toml") },
  {
    label: "extensions/customer-reviews-admin-block/shopify.extension.toml",
    version: readTomlApiVersion("extensions/customer-reviews-admin-block/shopify.extension.toml"),
  },
  { label: "app/shopify.server.ts (exported apiVersion)", version: serverApiVersion },
];

describe("Shopify API version pins", () => {
  const now = new Date();

  it.each(DECLARED_VERSIONS)("$label is declared and well-formed", ({ version }) => {
    expect(version).not.toBeNull();
    expect(version).toMatch(API_VERSION_PATTERN);
  });

  // The assertion that would have caught the 2025-10 drift.
  it.each(DECLARED_VERSIONS)("$label is still inside Shopify's support window", ({ version }) => {
    expect(isSupported(version!, now)).toBe(true);
  });

  // Catches drift ~3 months before it becomes an outage rather than on the day support ends,
  // which is the whole point of having a test instead of a dashboard warning.
  it.each(DECLARED_VERSIONS)("$label has at least 90 days of support remaining", ({ version }) => {
    const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    expect(
      isSupported(version!, ninetyDaysOut),
      `${version} drops out of support within 90 days — bump it (current stable: ${currentStableVersion(now)})`,
    ).toBe(true);
  });

  // The webhook api_version and the SDK's own ApiVersion must agree. These two drifting apart is
  // how a webhook payload ends up shaped differently from what the app's GraphQL client expects —
  // see shopify.app.toml's own comment recording exactly that near-miss.
  it("shopify.app.toml's webhook api_version matches app/shopify.server.ts's ApiVersion", () => {
    expect(readTomlApiVersion("shopify.app.toml")).toBe(serverApiVersion);
  });

  // The admin UI extension's runtime component library has to match the API version it declares,
  // or it builds against one version's components and runs against another's.
  it("the admin extension's @shopify/ui-extensions major matches its declared api_version", () => {
    const declared = readTomlApiVersion("extensions/customer-reviews-admin-block/shopify.extension.toml");
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "extensions/customer-reviews-admin-block/package.json"), "utf8"),
    );
    const dep: string = pkg.dependencies["@shopify/ui-extensions"];

    // api_version "2026-10" <-> dependency "2026.10.x"
    expect(dep.replace(/[^0-9.]/g, "").split(".").slice(0, 2).join("-")).toBe(declared);
  });
});

describe("support-window helpers", () => {
  it("treats a version as supported for 12 months after release", () => {
    expect(isSupported("2026-10", new Date("2026-10-01T00:00:00Z"))).toBe(true);
    expect(isSupported("2026-10", new Date("2027-09-30T00:00:00Z"))).toBe(true);
    expect(isSupported("2026-10", new Date("2027-10-01T00:00:00Z"))).toBe(false);
  });

  it("correctly identifies 2025-10 as out of support today — the original incident", () => {
    expect(isSupported("2025-10", new Date("2026-10-23T00:00:00Z"))).toBe(false);
  });

  it("resolves the current stable version from a date", () => {
    expect(currentStableVersion(new Date("2026-10-23T00:00:00Z"))).toBe("2026-10");
    expect(currentStableVersion(new Date("2026-09-30T00:00:00Z"))).toBe("2026-07");
    expect(currentStableVersion(new Date("2026-02-14T00:00:00Z"))).toBe("2026-01");
  });
});
