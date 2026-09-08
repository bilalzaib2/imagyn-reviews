// Regression test for the Settings Overview "Request Scheduling" (and every other
// ActionCard "Configure"/"Manage" button) navigation bug: clicking rendered a raw, broken
// response instead of the destination page. Root cause: ActionCard used a real <a href>,
// which App Bridge intercepts before any of the anchor's own click handling ever runs inside
// this app's embedded iframe — the exact failure mode app.settings.tsx's sidebar had already
// discovered and fixed by switching to a real <button onClick> + window.location.assign, but
// ActionCard was never updated to match. This locks down the shared fix both now use: a real
// top-level navigation (window.location.assign), appending the embedded-context query string,
// and only for a genuine unmodified left click.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTopLevelNavigate, type TopLevelNavigateEvent } from "./topLevelNavigate";

function clickEvent(overrides: Partial<TopLevelNavigateEvent> = {}): TopLevelNavigateEvent {
  return { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides };
}

describe("handleTopLevelNavigate", () => {
  // No DOM environment is configured for this project's vitest run (every other test file
  // exercises pure server-side logic) — window doesn't exist as a global here at all, so it's
  // stubbed directly rather than relying on jsdom/happy-dom.
  const assign = vi.fn();

  beforeEach(() => {
    assign.mockClear();
    vi.stubGlobal("window", { location: { assign } });
  });

  it("performs a real top-level navigation on a genuine left click, carrying the embedded-context query string", () => {
    handleTopLevelNavigate(clickEvent(), "/app/settings/requests", "?host=abc&shop=example.myshopify.com&embedded=1");

    expect(assign).toHaveBeenCalledWith("/app/settings/requests?host=abc&shop=example.myshopify.com&embedded=1");
  });

  it("navigates correctly even with an empty query string", () => {
    handleTopLevelNavigate(clickEvent(), "/app/settings/requests", "");
    expect(assign).toHaveBeenCalledWith("/app/settings/requests");
  });

  it("never navigates on a right/middle click", () => {
    handleTopLevelNavigate(clickEvent({ button: 1 }), "/app/settings/requests", "?host=abc");
    handleTopLevelNavigate(clickEvent({ button: 2 }), "/app/settings/requests", "?host=abc");
    expect(assign).not.toHaveBeenCalled();
  });

  it("never navigates when a modifier key is held (cmd/ctrl/shift/alt-click, e.g. open in new tab)", () => {
    handleTopLevelNavigate(clickEvent({ metaKey: true }), "/app/settings/requests", "?host=abc");
    handleTopLevelNavigate(clickEvent({ ctrlKey: true }), "/app/settings/requests", "?host=abc");
    handleTopLevelNavigate(clickEvent({ shiftKey: true }), "/app/settings/requests", "?host=abc");
    handleTopLevelNavigate(clickEvent({ altKey: true }), "/app/settings/requests", "?host=abc");
    expect(assign).not.toHaveBeenCalled();
  });
});
