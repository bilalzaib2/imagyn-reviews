// A stored value is not a label.
//
// Status badges used to carry `text-transform: uppercase`, which masked the fact that some
// of them rendered a raw enum straight from the database. Converting badges to sentence case
// took the mask off and the Coupons page began showing "issued", "revoked", "failed" and
// "active" in lower case. Caught by rendering the screen, not by any test.
//
// This pins the rule for every badge in the app: the child must be a mapped label or a
// formatter call, never a bare `thing.status`.
import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCES = [...globSync("app/routes/**/*.tsx"), ...globSync("app/components/**/*.tsx")].filter(
  (path) => !path.includes(".test."),
);

describe("status badges render labels, not stored values", () => {
  it("finds sources to check", () => {
    expect(SOURCES.length).toBeGreaterThan(30);
  });

  it("no badge renders a bare .status", () => {
    const offenders: string[] = [];

    for (const path of SOURCES) {
      const src = readFileSync(path, "utf8");
      for (const match of src.matchAll(/<StatusBadge[^>]*>\{([^}]+)\}<\/StatusBadge>/g)) {
        const child = match[1].trim();
        // `x.status` on its own is the stored value. A LABEL map lookup, a formatter call or
        // a ternary of literals are all fine.
        if (/^[\w.]+\.status$/.test(child)) {
          offenders.push(`${path}: {${child}}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("the coupon page maps both of its enums", () => {
    const src = readFileSync("app/routes/app.settings.coupons.tsx", "utf8");
    expect(src).toMatch(/const REDEMPTION_STATUS_LABEL: Record</);
    expect(src).toMatch(/const COUPON_STATUS_LABEL: Record</);

    // Every stored value needs a label, or the badge renders undefined.
    for (const value of ["issued", "failed", "revoked"]) {
      expect(src).toMatch(new RegExp(`${value}: "`));
    }
    for (const value of ["draft", "active", "paused", "ended"]) {
      expect(src).toMatch(new RegExp(`${value}: "`));
    }
  });
});
