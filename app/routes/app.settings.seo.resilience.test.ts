// A stored date must not be able to blank a settings page.
//
// formatGeneratedAt called Intl.DateTimeFormat on `new Date(value)` with no validity check.
// Intl THROWS a RangeError on an invalid date, and this runs during render, so one
// unparseable or missing timestamp sent the whole SEO settings page to its error boundary.
//
// Surfaced while adding the screen to the preview harness. The fixture there was wrong,
// which is how the crash appeared — but the fragility is real: generatedAt comes from a
// stored row, and a null on an older or partially-written record would do the same thing in
// production.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("app/routes/app.settings.seo.tsx", "utf8");

function formatterBody(): string {
  const start = SOURCE.indexOf("function formatGeneratedAt(");
  expect(start).toBeGreaterThan(-1);
  return SOURCE.slice(start, SOURCE.indexOf("\n}", start));
}

describe("formatGeneratedAt cannot throw during render", () => {
  it("accepts null and undefined in its signature", () => {
    expect(formatterBody()).toMatch(/value: Date \| string \| null \| undefined/);
  });

  it("checks the date is valid before formatting it", () => {
    expect(formatterBody()).toMatch(/Number\.isNaN\(date\.getTime\(\)\)/);
  });

  it("falls back to a dash rather than a blank screen", () => {
    expect(formatterBody()).toMatch(/return "—"/);
  });
});

// The grid-stretch class again, this time on buttons rather than tracks.
describe("a form's submit button is the size of its label", () => {
  const SECTION_CSS = readFileSync("app/components/ui/section.module.css", "utf8");

  it("stops direct-child buttons stretching across the column", () => {
    // Measured before the fix: "Save" twice at 1160px and "Send Test Email" at 1110px on
    // Settings → Review requests, and "Create coupon" at 1160px on Settings → Coupons.
    expect(SECTION_CSS).toMatch(/\.section > button \{[^}]*justify-self: start/);
  });

  it("leaves wrapped buttons alone, so a deliberate full-width control still works", () => {
    // The rule is a direct-child selector on purpose.
    expect(SECTION_CSS).toContain(".section > button");
    expect(SECTION_CSS).not.toMatch(/\.section button \{/);
  });
});
