// Every control a merchant can reach either does something, or is visibly disabled.
//
// The standard this enforces: no fake buttons, no dead links, no toggles that look live and
// are not. A control that accepts a click and silently does nothing is worse than a missing
// feature, because the merchant believes they have configured something.
//
// "Coming soon" labelling is allowed — but only on a control that is actually disabled, which
// is the pattern Settings → Requests already uses for the trigger types that still need
// Shopify webhook approval.
import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCES = [...globSync("app/routes/**/*.tsx"), ...globSync("app/components/**/*.tsx")].filter(
  (path) => !path.includes(".test."),
);

/** Source lines, minus comments, so an explanation of a rule is not mistaken for a breach. */
function codeLines(path: string): Array<{ line: number; text: string }> {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((text, index) => ({ line: index + 1, text: text.trim() }))
    .filter(({ text }) => text && !text.startsWith("//") && !text.startsWith("*") && !text.startsWith("/*"));
}

describe("no placeholder controls", () => {
  it("finds files to check, so a glob change cannot make this vacuous", () => {
    expect(SOURCES.length).toBeGreaterThan(30);
  });

  it("has no dead links", () => {
    // href="#" navigates nowhere and, in an embedded app, is intercepted by App Bridge into
    // an equally pointless no-op.
    const dead = SOURCES.flatMap((path) =>
      codeLines(path)
        .filter(({ text }) => text.includes('href="#"'))
        .map(({ line }) => `${path}:${line}`),
    );

    expect(dead).toEqual([]);
  });

  it("pairs every no-op handler with a disabled control", () => {
    // An empty handler is legitimate exactly once: satisfying a required prop on a control
    // that is disabled anyway. Anywhere else it is a button that lies.
    const offenders: string[] = [];

    for (const path of SOURCES) {
      const lines = codeLines(path);
      lines.forEach(({ line, text }, index) => {
        if (!/on[A-Z]\w*=\{\(\)\s*=>\s*(\{\s*\}|null|undefined)\s*\}/.test(text)) return;

        // The control's own JSX element, roughly: a few lines either side.
        const window = lines
          .slice(Math.max(0, index - 8), index + 8)
          .map((entry) => entry.text)
          .join(" ");

        if (!/\bdisabled\b/.test(window)) {
          offenders.push(`${path}:${line}  ${text.slice(0, 90)}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it("never marks something 'coming soon' without disabling it", () => {
    const offenders: string[] = [];

    for (const path of SOURCES) {
      const lines = codeLines(path);
      lines.forEach(({ line, text }, index) => {
        if (!/coming soon/i.test(text)) return;

        // A label declared in an options array sits far from the control that renders it —
        // Settings → Requests declares its trigger labels ~160 lines above the disabled
        // Select that consumes them. So for a plain data line the whole file is the scope;
        // for a line of JSX, the control itself is, and the window stays tight.
        const isJsx = text.includes("<") || /\bon[A-Z]\w*=/.test(text);
        const scope = isJsx
          ? lines
              .slice(Math.max(0, index - 10), index + 10)
              .map((entry) => entry.text)
              .join(" ")
          : lines.map((entry) => entry.text).join(" ");

        // Either the control is disabled, or the label is driven by a flag the code branches
        // on (available / disabled / comingSoon), which is the same promise kept differently.
        if (!/\bdisabled\b|\bavailable\b|\bcomingSoon\b/.test(scope)) {
          offenders.push(`${path}:${line}  ${text.slice(0, 90)}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
