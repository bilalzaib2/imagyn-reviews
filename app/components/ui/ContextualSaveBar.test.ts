// The save bar must never be the reason a screen fails to render.
//
// useAppBridge() throws synchronously when the `shopify` global is missing, and an error
// thrown in a component body takes the entire route to its error boundary. The global comes
// from a CDN script tag added by app.tsx's AppProvider, so on a slow network this app can
// hydrate before it exists.
//
// Six screens mount this component — Brand Studio, Email Studio and four Settings pages — so
// the blast radius of that throw is most of the app's configuration surface. Found by
// rendering Brand Studio in the preview harness, where App Bridge is genuinely absent: the
// page showed nothing but a stack trace.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("app/components/ui/ContextualSaveBar.tsx", "utf8");

/** The component bodies, split at the inner one that is allowed to use the hook. */
function exportedComponentBody(): string {
  const start = SOURCE.indexOf("export function ContextualSaveBar(");
  const end = SOURCE.indexOf("function ContextualSaveBarWithAppBridge(");
  expect(start, "exported component not found").toBeGreaterThan(-1);
  expect(end, "inner component not found").toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe("App Bridge is checked before it is used", () => {
  it("does not call useAppBridge in the exported component", () => {
    expect(exportedComponentBody()).not.toContain("useAppBridge()");
  });

  it("renders nothing until the global actually exists", () => {
    expect(exportedComponentBody()).toMatch(/useAppBridgeReady\(\) \?/);
  });

  it("checks the real global rather than assuming", () => {
    expect(SOURCE).toMatch(/window as \{ shopify\?: unknown \}\)\.shopify/);
  });

  it("confines the hook to a component that only mounts once App Bridge is present", () => {
    const inner = SOURCE.slice(SOURCE.indexOf("function ContextualSaveBarWithAppBridge("));
    expect(inner).toContain("useAppBridge()");
  });
});

describe("the readiness check cannot leak or spin forever", () => {
  it("clears its interval on unmount", () => {
    expect(SOURCE).toMatch(/return \(\) => window\.clearInterval\(timer\)/);
  });

  it("gives up rather than polling for the life of the session", () => {
    expect(SOURCE).toMatch(/attempts > \d+/);
  });

  it("stops polling as soon as App Bridge appears", () => {
    expect(SOURCE).toMatch(/setReady\(true\);[\s\S]{0,80}window\.clearInterval\(timer\)/);
  });

  it("does not poll at all when the global is already there", () => {
    // The effect checks the global synchronously and returns before setting up any interval,
    // so an App Bridge that is already present costs one tick, not a polling cycle.
    expect(SOURCE).toMatch(/shopify\) \{[\s\S]{0,60}setReady\(true\);[\s\S]{0,40}return;/);
    expect(SOURCE).toMatch(/if \(ready \|\| typeof window === "undefined"\) return;/);
  });

  // Regression guard. Seeding the initial state from `window.shopify` made the first client
  // render disagree with the server (which renders null, having no `window`), and React
  // reported "Expected server HTML to contain a matching <ui-save-bar> in <div>" and failed
  // hydration outright. In development that costs the whole stylesheet, because React Router
  // serves all dev CSS as one critical-CSS node that a from-scratch re-render discards —
  // measured on verveonline, Email Studio and Brand Studio each came back at 0 CSS rules.
  it("never seeds its initial state from the browser, which would break hydration", () => {
    expect(SOURCE).toMatch(/const \[ready, setReady\] = useState\(false\)/);
    expect(SOURCE).not.toMatch(/useState\(\s*\(\) => typeof window/);
  });
});

describe("every screen that mounts it is covered by this guard", () => {
  it.each([
    "app/routes/app.appearance.tsx",
    "app/routes/app.email-studio.tsx",
    "app/routes/app.settings.requests.tsx",
    "app/routes/app.settings.referrals.tsx",
    "app/routes/app.settings.moderation.tsx",
    "app/routes/app.settings.rewards.tsx",
  ])("%s uses the guarded export, not the hook directly", (route) => {
    const source = readFileSync(route, "utf8");
    expect(source).toContain("ContextualSaveBar");
    // A route reaching for useAppBridge itself would reintroduce the same crash.
    expect(source).not.toContain("useAppBridge(");
  });
});
