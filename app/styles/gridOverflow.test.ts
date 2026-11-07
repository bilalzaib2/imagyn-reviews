// Single-column layout grids must clamp their track.
//
// THE BUG THIS EXISTS FOR
//
// `display: grid` with no `grid-template-columns` creates one implicit `auto` track, and an
// auto track sizes to its content's MAX-content width. A wide child — a data table, a
// segmented control, a long toolbar — therefore widens the grid past its container instead
// of overflowing inside its own box, and the whole page scrolls sideways.
//
// `min-width: 0` on the child does not fix it: the track is what overflows, not the item.
// Only an explicit `minmax(0, …)` track does.
//
// Measured on the Reviews screen at a 400px viewport before the fix: the page grid's track
// resolved to 483px inside a 342px page, and the document scrolled 115px sideways. Four
// separate grids in the chain each had to be clamped — .page, .section, .toolbar and
// .listColumn — which is exactly why this is worth a test rather than four code comments.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Layout containers that wrap arbitrary page content, with the file they live in. */
const LAYOUT_GRIDS: Array<[file: string, selector: string]> = [
  ["app/styles/app.shell.module.css", "page"],
  ["app/components/ui/section.module.css", "section"],
  ["app/styles/app.reviews.module.css", "toolbar"],
  ["app/styles/app.reviews.module.css", "listColumn"],
  ["app/styles/app.reviews.module.css", "splitLayout"],
];

function ruleFor(file: string, selector: string): string | null {
  const css = readFileSync(file, "utf8");
  const match = css.match(new RegExp(`^\\.${selector} \\{[^}]*\\}`, "m"));
  return match ? match[0] : null;
}

describe("layout grids cannot be widened by their content", () => {
  it.each(LAYOUT_GRIDS)("%s .%s declares a clamped track", (file, selector) => {
    const rule = ruleFor(file, selector);
    expect(rule, `.${selector} not found in ${file}`).not.toBeNull();

    // Only grids are at risk; a flex or block container is fine as it is.
    if (!/display:\s*grid/.test(rule!)) return;

    expect(rule, `.${selector} is a grid with an implicit auto track`).toMatch(/grid-template-columns:\s*minmax\(0,/);
  });
});

describe("the table scrolls inside its own box", () => {
  const TABLE_CSS = readFileSync("app/components/ui/table.module.css", "utf8");

  it("lets the wrapper be narrower than the table it holds", () => {
    // Without min-width: 0 a grid item defaults to min-content, so the table's own minimum
    // propagates up the layout instead of being contained here.
    expect(TABLE_CSS).toMatch(/\.wrap \{[\s\S]*?min-width: 0;[\s\S]*?\}/);
  });

  it("keeps the checkbox column at its declared width", () => {
    // `.table thead th` outranks `.checkboxCell`, and `--table-col-width` is undefined for
    // that column, so an unscoped rule reset its width to auto and a fixed-layout table
    // handed the empty checkbox 155px — as much as the review text beside it.
    const widthRules = [...TABLE_CSS.matchAll(/^[^\n]*thead th[^{]*\{[^}]*width: var\(--table-col-width/gm)];
    expect(widthRules.length).toBeGreaterThan(0);
    for (const rule of widthRules) {
      expect(rule[0], "a width rule still targets the checkbox column").toContain(":not(.checkboxCell)");
    }
  });
});
