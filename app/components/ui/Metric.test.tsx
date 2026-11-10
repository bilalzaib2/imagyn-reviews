import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Metric } from "./Metric";
import { StarRating } from "../reviews/StarRating";

// Metric's value/label/sub slots are all typed ReactNode, so callers pass elements into them.
// Wrapping a ReactNode slot in a <p> is a real defect, not a style preference: a block element
// inside a paragraph is invalid HTML, the browser's parser auto-closes the <p> when it reaches
// one, and the parsed DOM can then never match the tree React rendered on the server.
//
// The dashboard hit exactly this — <StarRating/> (root: a <div>) passed as `sub` — and in
// development the consequence was not a warning but a completely unstyled app, because React
// Router serves all dev CSS as a single critical-CSS node that does not survive a failed
// hydration. These tests pin the shape so it cannot regress into that again.
describe("Metric slot markup", () => {
  it("never wraps a slot in a <p>, which a block-level child would invalidate", () => {
    const html = renderToStaticMarkup(<Metric value="3.5" label="Average rating" />);

    // `<p(?=[\s>])` and not just "<p", because the star icons render <path> elements and a
    // naive substring check matches those instead — which would make this test pass for the
    // wrong reason the moment a slot contains an icon.
    expect(html).not.toMatch(/<p(?=[\s>])/);
  });

  it("renders a block-level element passed as `sub` without nesting it inside a paragraph", () => {
    const html = renderToStaticMarkup(
      <Metric value="3.5" label="Average rating" sub={<StarRating value={3.5} />} />,
    );

    // The real dashboard composition: if this ever renders <p>…<div, the browser will close
    // the paragraph early and hydration will fail.
    expect(html).not.toMatch(/<p(?=[\s>])[^>]*>(?:(?!<\/p>).)*<div/s);
    expect(html).toContain("Average rating");
  });

  it("still renders the value and label content", () => {
    const html = renderToStaticMarkup(<Metric value="12" label="Total reviews" sub="this month" />);

    expect(html).toContain("12");
    expect(html).toContain("Total reviews");
    expect(html).toContain("this month");
  });
});
