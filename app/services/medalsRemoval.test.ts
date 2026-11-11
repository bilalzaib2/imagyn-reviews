import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Medals/Achievements feature was removed on 2026-11-11 at the owner's request. The
// requirement was removal, not concealment: "Do not merely hide Medals using CSS or feature
// flags." These tests are the standing proof of that — a reintroduced route, component or API
// field fails here rather than shipping quietly.
//
// The Achievement database table is deliberately exempt. Dropping it would destroy real
// merchant history and the removal was explicitly scoped to exclude destructive migrations;
// see the retained-but-unused note on the model in prisma/schema.prisma.
const ROOT = process.cwd();

/** Source trees that must contain no trace of the feature. Excludes prisma/ by design. */
const APPLICATION_TREES = ["app", "extensions", "tools"];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue;
      yield* walk(rel);
    } else {
      yield rel;
    }
  }
}

const SOURCE_FILES = APPLICATION_TREES.filter((d) => existsSync(join(ROOT, d))).flatMap((d) => [...walk(d)]);

describe("the Medals feature is gone, not hidden", () => {
  it("has source files to check", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
  });

  it.each([
    "app/routes/app.medals.tsx",
    "app/routes/api.reviews.medals.tsx",
    "app/styles/app.medals.module.css",
    "app/components/medals/Medallion.tsx",
    "app/components/medals/medallion.module.css",
    "app/services/achievements.server.ts",
    "app/services/achievements.shared.ts",
    "extensions/imagyn-review-widgets/blocks/medals_showcase.liquid",
    "extensions/imagyn-review-widgets/assets/medals-showcase.js",
    "extensions/imagyn-review-widgets/assets/imagyn-component-medals-showcase.css",
    "extensions/imagyn-review-widgets/assets/imagyn-component-medals.css",
  ])("%s no longer exists", (path) => {
    expect(existsSync(join(ROOT, path))).toBe(false);
  });

  it("no application source file mentions medals or achievements", () => {
    // This file is the obvious exception — it names the thing it is checking has gone.
    const offenders = SOURCE_FILES.filter(
      (file) => file !== "app/services/medalsRemoval.test.ts" && /medal|achievement/i.test(readFileSync(join(ROOT, file), "utf8")),
    );

    // Named individually so a failure says which file reintroduced it, not just that one did.
    expect(offenders).toEqual([]);
  });

  it("the merchant route is unreachable because no route module defines it", () => {
    const routes = readdirSync(join(ROOT, "app", "routes"));
    expect(routes.filter((f) => /medal/i.test(f))).toEqual([]);
  });

  it("the theme extension ships no medals block or asset", () => {
    const blocks = readdirSync(join(ROOT, "extensions", "imagyn-review-widgets", "blocks"));
    const assets = readdirSync(join(ROOT, "extensions", "imagyn-review-widgets", "assets"));

    expect(blocks.filter((f) => /medal/i.test(f))).toEqual([]);
    expect(assets.filter((f) => /medal/i.test(f))).toEqual([]);
  });

  it("the storefront API payloads no longer carry a medals field", () => {
    for (const route of ["app/routes/api.reviews.tsx", "app/routes/api.reviews.store.tsx"]) {
      expect(readFileSync(join(ROOT, route), "utf8")).not.toMatch(/\bmedals\b/i);
    }
  });
});

describe("features that shared surfaces with Medals still exist", () => {
  // Medals sat alongside these in the Widgets dashboard, the storefront bundle and the
  // settings sidebar. Removing it must not have taken any of them with it.
  it.each([
    ["app/services/rewards.server.ts", "review rewards"],
    ["app/services/coupons.server.ts", "coupons"],
    ["app/services/shopifyDiscount.server.ts", "Shopify discount codes"],
    ["app/services/review.server.ts", "review collection and moderation"],
    ["app/services/reviewMedia.server.ts", "photo and video reviews"],
    ["app/services/analytics.server.ts", "analytics"],
    ["app/services/appearance.server.ts", "the storefront appearance system"],
  ])("%s still exists (%s)", (path) => {
    expect(existsSync(join(ROOT, path))).toBe(true);
  });

  it("the Widgets dashboard still offers the other storefront widgets", () => {
    const source = readFileSync(join(ROOT, "app/routes/app.widgets.tsx"), "utf8");

    for (const key of ["product-reviews-widget", "product-rating-badge", "review-carousel", "store-reviews"]) {
      expect(source).toContain(key);
    }
  });

  it("the store reviews widget still renders its summary after losing the medals section", () => {
    const source = readFileSync(join(ROOT, "extensions/imagyn-review-widgets/assets/store-reviews.js"), "utf8");

    expect(source).toContain("renderAiSummary");
    expect(source).toMatch(/renderHistogram|ratingCounts/);
  });
});

describe("the Achievement table is retained rather than dropped", () => {
  const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");

  it("still declares the model, so no DROP is ever generated", () => {
    expect(schema).toMatch(/model Achievement \{/);
  });

  it("says plainly that it is unused and why it is kept", () => {
    expect(schema).toMatch(/RETAINED, UNUSED/);
    expect(schema).toMatch(/separate, separately-approved migration/);
  });

  it("no migration drops it", () => {
    const dir = join(ROOT, "prisma", "migrations");
    const offenders = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => /DROP TABLE[^;]*Achievement/i.test(readFileSync(join(dir, e.name, "migration.sql"), "utf8")));

    expect(offenders.map((e) => e.name)).toEqual([]);
  });
});
