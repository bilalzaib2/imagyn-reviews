// Every merchant screen names itself.
//
// Email Studio did not. It rendered a breadcrumb and then went straight to section-level
// h2s, leaving the page with no top-level heading for a screen reader to land on and no
// visual anchor above its tab row. It was the only screen like that, and nothing noticed
// because no test rendered it — it was found by adding it to the preview harness.
//
// Settings sub-screens are deliberately exempt: app.settings.tsx is a layout route with an
// Outlet and an unconditional <h1>Settings</h1>, so its children inherit one.
import { globSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";

/** A route that renders UI, as opposed to a loader/action-only resource route. */
function isScreen(path: string): boolean {
  const src = readFileSync(path, "utf8");
  return src.includes("export default function");
}

/** Children of the settings layout, which supplies their heading. */
function isSettingsChild(path: string): boolean {
  const name = basename(path);
  return name.startsWith("app.settings.") && name !== "app.settings.tsx";
}

const SCREENS = globSync("app/routes/app*.tsx")
  .filter((path) => !path.includes(".test."))
  .filter(isScreen)
  .filter((path) => !isSettingsChild(path));

describe("screen headings", () => {
  it("finds screens to check, so this cannot go vacuous", () => {
    expect(SCREENS.length).toBeGreaterThan(8);
  });

  it.each(SCREENS)("%s renders a top-level heading", (path) => {
    const src = readFileSync(path, "utf8");
    // Either directly, or through PageHeader, which renders the h1 itself.
    expect(/<h1[\s>]/.test(src) || src.includes("<PageHeader")).toBe(true);
  });

  it("the settings layout supplies one for its children", () => {
    const layout = readFileSync("app/routes/app.settings.tsx", "utf8");
    expect(layout).toMatch(/<h1[^>]*>Settings<\/h1>/);
    expect(layout).toContain("<Outlet />");
  });
});

describe("uppercase is gone from merchant-facing chips", () => {
  // The status badges were converted first; .currentTag in the email template gallery was
  // the last one left, and it stood out immediately once the rest were sentence case.
  it.each([
    ["app/styles/shared.module.css", "statusBadge"],
    ["app/components/email/template-gallery.module.css", "currentTag"],
  ])("%s .%s is not uppercase", (file, selector) => {
    const css = readFileSync(file, "utf8");
    const rule = css.match(new RegExp(`^\\.${selector} \\{[^}]*\\}`, "m"));
    expect(rule, `.${selector} not found`).not.toBeNull();
    expect(rule![0]).not.toContain("text-transform: uppercase");
  });
});
