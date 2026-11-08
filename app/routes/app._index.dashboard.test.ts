// The Dashboard's fresh-install behaviour.
//
// This is the first screen a merchant ever sees, and until 2026-11-09 it greeted a brand-new
// store — nothing imported, nothing configured, five setup steps outstanding — with
// "You're all caught up — nothing needs your attention right now." The subtitle only looked
// at the pending-moderation count, and an empty queue read identically to an empty store.
//
// Caught by rendering the fresh-install state in the preview harness. No test had the data
// to notice, because no test rendered this screen with zero reviews.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTE = readFileSync("app/routes/app._index.tsx", "utf8");

describe("the greeting tells the truth about an empty store", () => {
  it("distinguishes an empty queue from an empty store", () => {
    // Three branches, not two: pending work, nothing collected yet, and genuinely clear.
    expect(ROUTE).toMatch(/function dashboardSubtitle\(/);
    expect(ROUTE).toMatch(/stats\.totalReviews === 0/);
  });

  it("only says 'all caught up' when reviews actually exist", () => {
    const fn = ROUTE.slice(ROUTE.indexOf("function dashboardSubtitle("), ROUTE.indexOf("export default function"));
    const caughtUpAt = fn.indexOf("all caught up");
    const emptyStoreAt = fn.indexOf("stats.totalReviews === 0");

    expect(caughtUpAt).toBeGreaterThan(-1);
    expect(emptyStoreAt).toBeGreaterThan(-1);
    // The empty-store branch must return before the catch-all can be reached.
    expect(emptyStoreAt).toBeLessThan(caughtUpAt);
  });

  it("counts the remaining setup steps for a new merchant", () => {
    const fn = ROUTE.slice(ROUTE.indexOf("function dashboardSubtitle("), ROUTE.indexOf("export default function"));
    expect(fn).toMatch(/incompleteSetupCount/);
    expect(fn).toMatch(/step\$\{incompleteSetupCount === 1 \? "" : "s"\}/);
  });

  it("pluralises both counts", () => {
    const fn = ROUTE.slice(ROUTE.indexOf("function dashboardSubtitle("), ROUTE.indexOf("export default function"));
    expect(fn).toMatch(/review\$\{stats\.pendingReviews === 1 \? "" : "s"\}/);
  });
});

describe("a store with nothing in it leads with what to do, not with zeroes", () => {
  it("decides the order from real emptiness, not from a flag", () => {
    expect(ROUTE).toMatch(/const leadWithSetup = stats\.totalReviews === 0 && incompleteSetupItems\.length > 0;/);
  });

  it("renders the setup guide before the metrics only in that case", () => {
    // Both placements exist and are mutually exclusive, so the section can never render
    // twice or vanish entirely.
    expect(ROUTE).toContain("{leadWithSetup ? setupGuideSection : null}");
    expect(ROUTE).toContain("{leadWithSetup ? null : setupGuideSection}");
  });

  it("puts the metrics first once there are reviews to report", () => {
    const leadPlacement = ROUTE.indexOf("{leadWithSetup ? setupGuideSection : null}");
    const metrics = ROUTE.indexOf("styles.reputationRow");
    const trailPlacement = ROUTE.indexOf("{leadWithSetup ? null : setupGuideSection}");

    expect(leadPlacement).toBeLessThan(metrics);
    expect(metrics).toBeLessThan(trailPlacement);
  });
});
