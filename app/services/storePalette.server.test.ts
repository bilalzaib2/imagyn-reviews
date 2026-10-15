// The extractor is a pure function over markup, so it is tested against real theme shapes
// with no network at all.
import { describe, expect, it } from "vitest";
import { extractStorePalette, isDarkBackground, parseColorValue } from "./storePalette.server";

describe("parseColorValue — the notations Shopify themes actually use", () => {
  it("reads 6-digit hex", () => expect(parseColorValue("#1F7A5A")).toBe("#1f7a5a"));
  it("reads 3-digit hex", () => expect(parseColorValue("#0a5")).toBe("#00aa55"));
  it("reads rgb()", () => expect(parseColorValue("rgb(31, 122, 90)")).toBe("#1f7a5a"));
  it("reads Dawn's bare r, g, b triple", () => expect(parseColorValue("31, 122, 90")).toBe("#1f7a5a"));
  it("reads rgba() with a solid alpha", () => expect(parseColorValue("rgba(31,122,90,0.95)")).toBe("#1f7a5a"));

  it("rejects a near-transparent value — that is a scrim, not a brand colour", () => {
    expect(parseColorValue("rgba(31,122,90,0.08)")).toBeNull();
  });

  it("rejects out-of-range triples rather than clamping them into a wrong colour", () => {
    expect(parseColorValue("300, 122, 90")).toBeNull();
  });

  it("returns null for anything it cannot parse", () => {
    expect(parseColorValue("var(--something)")).toBeNull();
    expect(parseColorValue("inherit")).toBeNull();
    expect(parseColorValue("")).toBeNull();
  });
});

describe("extractStorePalette", () => {
  it("prefers a colour named like a brand over an incidental chromatic one", () => {
    const html = `<style>:root{--some-chart-tint:#7b2ff7;--color-brand:#1f7a5a;}</style>`;
    expect(extractStorePalette(html).accent).toBe("#1f7a5a");
  });

  it("ranks accent above a generic chromatic value", () => {
    const html = `<style>:root{--decor:#aa3366;--color-accent-1:#c2185b;}</style>`;
    expect(extractStorePalette(html).accent).toBe("#c2185b");
  });

  it("ignores greys — structure is not a brand colour", () => {
    const html = `<style>:root{--color-border:#e5e5e5;--color-text:#111111;--color-button:#c2185b;}</style>`;
    const palette = extractStorePalette(html);
    expect(palette.accent).toBe("#c2185b");
    expect(palette.candidates).not.toContain("#e5e5e5");
    expect(palette.candidates).not.toContain("#111111");
  });

  it("reads Dawn-style triples", () => {
    const html = `<style>:root{--color-base-accent-1: 194, 24, 91;--color-base-background-1: 255,255,255;}</style>`;
    expect(extractStorePalette(html).accent).toBe("#c2185b");
  });

  it("picks up the page background separately from the accent", () => {
    const html = `<style>:root{--color-background:#101014;--color-brand:#f5b544;}</style>`;
    const palette = extractStorePalette(html);
    expect(palette.background).toBe("#101014");
    expect(palette.accent).toBe("#f5b544");
  });

  // Deliberate: only colours a theme NAMED as brand-ish are offered. Accepting any chromatic
  // value surfaced a rainbow of semantic status colours on a real storefront, and offering a
  // merchant their sale-price red as a "brand colour" is worse than offering nothing.
  it("ignores a chromatic colour the theme never named as brand-like", () => {
    const html = `<style>:root{--t4s-shop-tone:#c2185b;}</style>`;
    expect(extractStorePalette(html).accent).toBeNull();
  });

  it("ignores semantic colours even when their name contains a brand-like word", () => {
    const html = `<style>:root{--primary-price-color:#970000;--product-price-sale-color:#970000;}</style>`;
    expect(extractStorePalette(html).accent).toBeNull();
  });

  it("does not mistake a tooltip background for the page background", () => {
    const html = `<style>:root{--t4s-tooltip-background:#383838;}</style>`;
    expect(extractStorePalette(html).background).toBeNull();
  });

  it("returns nothing for a password-protected storefront rather than reading Shopify's own gate", () => {
    const html = `<form action="/password" method="post"><style>:root{--color-brand:#5a31f4;}</style></form>`;
    const palette = extractStorePalette(html);
    expect(palette.accent).toBeNull();
    expect(palette.candidates).toEqual([]);
  });

  it("returns nothing for empty or colourless markup instead of inventing a colour", () => {
    expect(extractStorePalette("").accent).toBeNull();
    expect(extractStorePalette("<html><body>hi</body></html>").accent).toBeNull();
  });

  it("deduplicates and caps the candidate list", () => {
    const decls = Array.from({ length: 30 }, (_, i) => `--btn-color-${i}:#c2185b;`).join("");
    const palette = extractStorePalette(`<style>:root{${decls}}</style>`);
    expect(palette.candidates).toEqual(["#c2185b"]);
  });
});

describe("isDarkBackground", () => {
  it("recognises a dark storefront", () => expect(isDarkBackground("#101014")).toBe(true));
  it("recognises a light storefront", () => expect(isDarkBackground("#ffffff")).toBe(false));
  it("does not guess when there is no background", () => expect(isDarkBackground(null)).toBe(false));
});
