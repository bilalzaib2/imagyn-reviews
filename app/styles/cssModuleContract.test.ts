// Every `styles.x` in the app resolves to a class that actually exists.
//
// WHY THIS EXISTS
//
// A CSS-module key that does not exist is not an error anywhere. TypeScript types a module as
// an index signature, so `styles.doesNotExist` compiles. Vite resolves it to `undefined` and
// React renders `class="undefined"`. Nothing fails: not the build, not the linter, not a unit
// test, not a render test. The element simply loses all of its styling, silently, in
// production.
//
// Three of these were found by hand in a single session:
//
//   app.requests.tsx    styles.visuallyHidden   would have rendered the "Actions" column
//                                               header visibly instead of hiding it
//   app.settings.seo.tsx  styles.fieldGroup     every status row rendered with no spacing
//                                               (fixed earlier, recorded in that stylesheet)
//   app._index.tsx      styles.activityRating   the dashboard's activity rows had an
//                                               unstyled flex child that could let the star
//                                               rating wrap mid-row
//
// Finding the third one by accident is what prompted this test. It is cheap — it reads source
// files and never renders anything — and it closes the whole class of bug rather than the
// three instances.
import { globSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Every class name appearing in a selector position in a stylesheet. */
function definedClasses(cssPath: string): Set<string> | null {
  let css: string;
  try {
    css = readFileSync(cssPath, "utf8");
  } catch {
    return null;
  }
  return new Set([...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]));
}

interface Reference {
  source: string;
  alias: string;
  stylesheet: string;
  key: string;
}

/** Every `alias.key` reference in a component, paired with the stylesheet `alias` imports. */
function referencesIn(sourcePath: string): Reference[] {
  const src = readFileSync(sourcePath, "utf8");
  const refs: Reference[] = [];

  for (const [, alias, rel] of src.matchAll(/import\s+(\w+)\s+from\s+"([^"]+\.css)"/g)) {
    const stylesheet = relative(process.cwd(), resolve(dirname(sourcePath), rel));

    for (const [, key] of src.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g"))) {
      // `styles.module` is this regex matching the ".module.css" inside the import specifier
      // itself, not a real reference — the alias happens to be followed by ".module" there.
      if (key === "module") continue;
      refs.push({ source: relative(process.cwd(), sourcePath), alias, stylesheet, key });
    }
  }

  return refs;
}

const SOURCES = [
  ...globSync("app/routes/**/*.tsx"),
  ...globSync("app/components/**/*.tsx"),
].filter((path) => !path.endsWith(".test.tsx"));

describe("CSS module references", () => {
  it("finds source files to check, so a glob change cannot make this test vacuous", () => {
    expect(SOURCES.length).toBeGreaterThan(30);
  });

  it("every stylesheet a component imports exists", () => {
    const missing = SOURCES.flatMap((source) =>
      referencesIn(source)
        .filter((ref) => definedClasses(ref.stylesheet) === null)
        .map((ref) => `${ref.source} imports ${ref.stylesheet}`),
    );

    expect([...new Set(missing)]).toEqual([]);
  });

  // The one that matters. A failure here names the file, the key and the stylesheet it is
  // missing from, so the fix is either to define the class or to correct the typo.
  it("every styles.x reference resolves to a class that exists", () => {
    const undefinedRefs = SOURCES.flatMap((source) => {
      const refs = referencesIn(source);
      return refs
        .filter((ref) => {
          const defined = definedClasses(ref.stylesheet);
          return defined !== null && !defined.has(ref.key);
        })
        .map((ref) => `${ref.source}: ${ref.alias}.${ref.key} is not defined in ${ref.stylesheet}`);
    });

    expect([...new Set(undefinedRefs)].sort()).toEqual([]);
  });
});
