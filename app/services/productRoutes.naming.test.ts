// Regression test for a real bug: clicking a product on /app/products did nothing. Root cause
// was route *file naming*, not click handling. React Router's flat-routes convention treats
// any file starting with "app.products." as a nested child of app.products.tsx (same prefix).
// app.products.tsx's own component never renders an <Outlet />, so a naively-named
// "app.products.$id.tsx" detail route could never actually display — React Router matched the
// URL and even ran the child loader, but only the parent's (list) markup was ever rendered.
// The fix is flat-routes' documented escape hatch: a trailing underscore on the shared prefix
// segment ("app.products_.$id.tsx") opts the file out of that implicit parent/child nesting,
// while still resolving to the same "/app/products/:id" URL. This test only asserts the
// on-disk naming stays correct — see docs/DECISIONS.md for the full investigation. flatRoutes()
// itself can't be invoked standalone outside the Vite build pipeline (confirmed live: it
// throws, requiring internal @react-router/dev context it only gets during an actual
// build/dev run), so asserting file naming directly is the practical way to guard against this
// regressing. Deliberately NOT placed under app/routes/ — a .test.ts file there gets swept up
// by the framework's own route-file convention and breaks the client build (confirmed live:
// "node:fs"/"node:path" externalized-for-browser errors), so this lives alongside every other
// test in app/services/ instead.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES_DIR = resolve(__dirname, "../routes");

describe("Products list/detail route file naming", () => {
  it("the product detail route uses the trailing-underscore escape so it is NOT nested under the products list route", () => {
    expect(existsSync(resolve(ROUTES_DIR, "app.products_.$id.tsx"))).toBe(true);
  });

  it("the old, buggy filename (implicitly nested, never rendered) does not exist", () => {
    expect(existsSync(resolve(ROUTES_DIR, "app.products.$id.tsx"))).toBe(false);
  });

  it("the products list route file still exists (this test's premise depends on it)", () => {
    expect(existsSync(resolve(ROUTES_DIR, "app.products.tsx"))).toBe(true);
  });
});
