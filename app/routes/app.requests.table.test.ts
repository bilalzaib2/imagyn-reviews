// The Review requests table.
//
// Both defects here were found by rendering the screen, not by reading it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTE = readFileSync("app/routes/app.requests.tsx", "utf8");

describe("order numbers carry exactly one hash", () => {
  // The column did `#${orderNumber}` unconditionally. A merchant typing into the manual form
  // writes "1040", but the fulfillment webhook stores Shopify's `fulfillment.name`, which
  // already carries its own "#" — so every automatically-created request rendered "##1040",
  // and those are most requests once order automation is on.
  it("normalises rather than prefixing blindly", () => {
    expect(ROUTE).toMatch(/function formatOrderNumber\(/);
    expect(ROUTE).not.toMatch(/`#\$\{request\.orderNumber\}`/);
  });

  it("strips any leading hashes before adding one", () => {
    const fn = ROUTE.slice(ROUTE.indexOf("function formatOrderNumber("), ROUTE.indexOf("type CustomerOption"));
    expect(fn).toMatch(/replace\(\/\^#\+\/, ""\)/);
  });

  it("renders an em dash for no order rather than a bare hash", () => {
    const fn = ROUTE.slice(ROUTE.indexOf("function formatOrderNumber("), ROUTE.indexOf("type CustomerOption"));
    expect(fn).toMatch(/return "—"/);
    // A whitespace-only value is no order either.
    expect(fn).toMatch(/orderNumber\?\.trim\(\)/);
  });
});

describe("the table sheds the columns its detail panel repeats", () => {
  const column = (key: string) => {
    const at = ROUTE.indexOf(`key: "${key}",`);
    expect(at, `column ${key} not found`).toBeGreaterThan(-1);
    return ROUTE.slice(at, ROUTE.indexOf("render:", at));
  };

  it.each(["email", "order", "trigger"])("%s goes first, because the panel shows it", (key) => {
    expect(column(key)).toContain("hideOnCramped: true");
  });

  it.each(["customer", "product", "status"])("%s is never shed first", (key) => {
    expect(column(key)).not.toContain("hideOnCramped");
  });

  it("keeps scheduled on the later tier", () => {
    // Measured at 42px before this change — too narrow for "Nov 1, 2026".
    expect(column("scheduled")).toContain("hideOnNarrow: true");
    expect(column("scheduled")).not.toContain("hideOnCramped");
  });
});
