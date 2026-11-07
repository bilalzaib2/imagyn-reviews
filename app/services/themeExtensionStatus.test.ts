// Interpreting shopify.app.extensions() into one honest answer about the storefront widget.
//
// The rule being protected: we may never tell a merchant their widget is missing when we
// simply could not look. They would go and re-add a block that is already there, and trust
// the next status we show them less.
import { describe, expect, it } from "vitest";
import { summariseThemeBlocks, themeBlockStatusLabel } from "./themeExtensionStatus.shared";

const themeExt = (...activations: Array<{ status: string; name?: string; handle?: string }>) => [
  { handle: "imagyn-reviews", type: "theme_app_extension", activations },
];

describe("reading the published theme", () => {
  it("reports active when a block is in the theme", () => {
    const summary = summariseThemeBlocks(themeExt({ status: "active", name: "Review Widget" }));
    expect(summary.status).toBe("active");
    expect(summary.active).toEqual(["Review Widget"]);
  });

  it("reports available when a block exists but was never added", () => {
    const summary = summariseThemeBlocks(themeExt({ status: "available", name: "Review Widget" }));
    expect(summary.status).toBe("available");
    expect(summary.inactive).toEqual(["Review Widget"]);
  });

  it("reports unavailable when a block is disabled in the theme", () => {
    const summary = summariseThemeBlocks(themeExt({ status: "unavailable", name: "Star Badge" }));
    expect(summary.status).toBe("unavailable");
  });

  it("leads with the best state, because one live block is enough to show reviews", () => {
    const summary = summariseThemeBlocks(
      themeExt({ status: "available", name: "Star Badge" }, { status: "active", name: "Review Widget" }),
    );
    expect(summary.status).toBe("active");
    expect(summary.active).toEqual(["Review Widget"]);
    expect(summary.inactive).toEqual(["Star Badge"]);
  });

  it("ignores UI extensions, which say nothing about the storefront", () => {
    const summary = summariseThemeBlocks([
      { handle: "checkout-thing", type: "ui_extension", activations: [{ target: "purchase.thank-you.block.render" }] },
    ]);
    expect(summary.status).toBe("unknown");
  });
});

describe("never claims absence it did not observe", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty array", []],
    ["a string", "nope"],
    ["an object", { extensions: [] }],
    ["a theme extension with no activations", [{ handle: "x", type: "theme_app_extension" }]],
    ["activations that are not an array", [{ handle: "x", type: "theme_app_extension", activations: "broken" }]],
    ["an unrecognised status value", themeExt({ status: "something_new", name: "Review Widget" })],
  ])("returns unknown for %s", (_label, input) => {
    expect(summariseThemeBlocks(input).status).toBe("unknown");
  });

  it("does not throw on a shape the platform changed under us", () => {
    // App Bridge has already renamed fields here once across versions. A TypeError on the
    // dashboard would be far worse than an unknown status.
    expect(() => summariseThemeBlocks([{ type: "theme_app_extension", activations: [null, 5, {}] }])).not.toThrow();
  });

  it("falls back to the handle, then to a positional name, rather than rendering undefined", () => {
    const byHandle = summariseThemeBlocks(themeExt({ status: "active", handle: "review-widget" }));
    expect(byHandle.active).toEqual(["review-widget"]);

    const positional = summariseThemeBlocks(themeExt({ status: "active" }));
    expect(positional.active).toEqual(["Block 1"]);
  });
});

describe("the wording shown to a merchant", () => {
  it.each([
    ["active", "Live on your theme"],
    ["available", "Not added to your theme yet"],
    ["unavailable", "Disabled in your theme"],
    ["unknown", "Theme status unavailable"],
  ] as const)("%s reads as %s", (status, expected) => {
    expect(themeBlockStatusLabel(status)).toBe(expected);
  });

  it("never says installed or live unless the block really is active", () => {
    for (const status of ["available", "unavailable", "unknown"] as const) {
      expect(themeBlockStatusLabel(status)).not.toMatch(/\blive\b|\binstalled\b/i);
    }
  });
});
