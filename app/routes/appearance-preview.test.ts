// Exercises the Brand Studio live-preview frame (appearance-preview.tsx).
//
// The invariant worth protecting is coverage: the Appearance page lets a merchant select any
// SurfaceKey and preview it, so a surface with no fixture means selecting it shows an empty
// frame with no explanation. A new entry in the SurfaceKey union should fail here rather than
// in front of a merchant.
import { describe, expect, it } from "vitest";
import { SURFACE_KEYS } from "../services/appearance.shared";
import { loader } from "./appearance-preview";

async function previewHtml(): Promise<string> {
  const response = await loader({
    request: new Request("https://example.com/appearance-preview"),
  } as never);
  return response.text();
}

describe("preview coverage", () => {
  it("renders a fixture for every surface a merchant can select", async () => {
    const html = await previewHtml();
    const declared = new Set(
      [...html.matchAll(/data-imagyn-preview-surfaces="([^"]*)"/g)].flatMap((match) => match[1].split(" ")),
    );

    const missing = SURFACE_KEYS.filter((key) => !declared.has(key));
    expect(missing).toEqual([]);
  });

  it("never falls back to the no-fixture placeholder", async () => {
    expect(await previewHtml()).not.toContain("has no preview fixture yet");
  });

  it("tags every block so the frame can filter to one surface", async () => {
    const html = await previewHtml();
    const blocks = html.match(/class="imagyn-preview-block"/g) ?? [];
    const tagged = html.match(/data-imagyn-preview-surfaces=/g) ?? [];

    expect(blocks.length).toBeGreaterThan(0);
    expect(tagged.length).toBe(blocks.length);
  });
});

describe("star rendering", () => {
  // Filled and unfilled stars have to be separate elements, or --imagyn-color-star-empty has
  // nothing to colour and a 4-star rating is told from a 5-star one by one glyph outline.
  it("renders unfilled stars as their own element so the empty-star colour applies", async () => {
    const html = await previewHtml();

    expect(html).toContain('class="imagyn-star imagyn-star--empty"');
    expect(html).toContain('class="imagyn-star"');
  });

  it("shows a partly-filled rating somewhere, so the two star colours are both visible", async () => {
    const html = await previewHtml();
    const empties = html.match(/imagyn-star--empty/g) ?? [];

    expect(empties.length).toBeGreaterThan(0);
  });
});

describe("histogram", () => {
  // The row grid sizes column 1 for a single numeral; the star-glyph label needs the wider
  // column that only this modifier turns on, or the glyphs run under the bar.
  it("marks a star-label histogram so its label column is widened", async () => {
    expect(await previewHtml()).toContain("imagyn-histogram--star-labels");
  });
});
