// Regression tests for Bug 1: back navigation from Reviews sub-pages.
//
// Root cause: LinkButton renders React Router's <Link> (an <a> tag) that App Bridge
// intercepts before React Router's click handler runs. The fix replaces these with
// <Button> + navigate() — a <button> element App Bridge does not intercept.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const NEW_REVIEW = readFileSync("app/routes/app.reviews_.new.tsx", "utf8");
const EDIT_REVIEW = readFileSync("app/routes/app.reviews_.$id.edit.tsx", "utf8");
const REVIEWS = readFileSync("app/routes/app.reviews.tsx", "utf8");
const EMPTY_STATE = readFileSync("app/components/ui/EmptyState.tsx", "utf8");

describe("sub-page cancel/back buttons bypass App Bridge", () => {
  it.each([
    ["New Review", NEW_REVIEW],
    ["Edit Review", EDIT_REVIEW],
  ])("%s does not import LinkButton", (_label, source) => {
    expect(source).not.toContain("LinkButton");
  });

  it.each([
    ["New Review", NEW_REVIEW],
    ["Edit Review", EDIT_REVIEW],
  ])("%s uses useNavigate for programmatic navigation", (_label, source) => {
    expect(source).toContain("useNavigate");
    expect(source).toMatch(/navigate\(backHref\)/);
  });

  it("Reviews list page uses navigate() for the New Review button", () => {
    expect(REVIEWS).toMatch(/onClick=\{.*navigate\(.*\/app\/reviews\/new/);
    expect(REVIEWS).not.toMatch(/LinkButton.*New Review/);
  });

  it("Reviews list page uses onAction for the Edit action, not url", () => {
    const editAction = REVIEWS.slice(
      REVIEWS.indexOf('content: "Edit"'),
      REVIEWS.indexOf('content: "Delete"'),
    );
    expect(editAction).toContain("onAction");
    expect(editAction).not.toMatch(/^\s*url:/m);
  });
});

describe("action redirects preserve search params", () => {
  it.each([
    ["New Review", NEW_REVIEW],
    ["Edit Review", EDIT_REVIEW],
  ])("%s redirect includes returnSearch", (_label, source) => {
    expect(source).toContain("returnSearch");
    expect(source).toMatch(/redirect\(`\/app\/reviews\$\{returnSearch\}`\)/);
  });

  it.each([
    ["New Review", NEW_REVIEW],
    ["Edit Review", EDIT_REVIEW],
  ])("%s does not hard-redirect to bare /app/reviews", (_label, source) => {
    expect(source).not.toMatch(/redirect\("\/app\/reviews"\)/);
  });
});

describe("EmptyState renders a button, not an anchor", () => {
  it("does not use React Router Link component", () => {
    expect(EMPTY_STATE).not.toMatch(/import \{[^}]*Link[^}]*\} from "react-router"/);
    expect(EMPTY_STATE).not.toContain("<Link");
  });

  it("uses useNavigate for programmatic navigation", () => {
    expect(EMPTY_STATE).toContain("useNavigate");
    expect(EMPTY_STATE).toMatch(/navigate\(action\.href\)/);
  });

  it("renders a <button>, not an <a>", () => {
    expect(EMPTY_STATE).toContain('<button type="button"');
    expect(EMPTY_STATE).not.toContain("<a ");
  });
});
