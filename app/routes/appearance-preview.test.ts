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

// This route is deliberately unauthenticated (it renders fixed fixtures, never store data), so
// nothing stops a third-party page from iframing it. The message listener must therefore accept
// instructions only from this app's own origin — otherwise any embedding page could push
// arbitrary appearance tokens into the frame. The sender side (app.appearance.tsx) performs the
// mirror-image check by targeting window.location.origin instead of "*".
//
// The runtime behaviour is exercised end-to-end in a real browser; these assertions pin the
// shipped source so the guard cannot be removed or reordered without a test failing.
describe("preview frame message origin validation", () => {
  it("checks event.origin against window.location.origin", async () => {
    const html = await previewHtml();
    expect(html).toContain("event.origin !== window.location.origin");
  });

  it("rejects a foreign origin BEFORE inspecting the payload", async () => {
    // Ordering matters: the origin check has to be the first statement in the handler, or a
    // foreign message still reaches applyScope/ImagynAppearance.apply.
    const html = await previewHtml();
    const handler = /addEventListener\(\s*"message"[\s\S]*?\}\s*\)\s*;/.exec(html)?.[0] ?? "";
    expect(handler).not.toBe("");

    const originCheck = handler.indexOf("event.origin !== window.location.origin");
    const payloadCheck = handler.indexOf("event.data.source");
    const applyScope = handler.indexOf("applyScope(");
    const applyTokens = handler.indexOf("ImagynAppearance.apply");

    expect(originCheck).toBeGreaterThan(-1);
    expect(originCheck).toBeLessThan(payloadCheck);
    expect(originCheck).toBeLessThan(applyScope);
    expect(originCheck).toBeLessThan(applyTokens);
  });

  it("still gates on the message's own source discriminator", async () => {
    // Same-origin alone isn't enough — other same-origin scripts post unrelated messages.
    const html = await previewHtml();
    expect(html).toContain('event.data.source !== "imagyn-appearance-draft"');
  });

  it("never uses a wildcard postMessage target in the preview frame", async () => {
    const html = await previewHtml();
    expect(html).not.toMatch(/postMessage\([^)]*,\s*["']\*["']\s*\)/);
  });
});

// Executes the frame's REAL shipped listener — the exact source string the loader emits, not a
// re-implementation — against stubbed browser globals, and fires same-origin and cross-origin
// messages at it. This is what proves the guard actually rejects rather than merely appearing in
// the output, which the source-order assertions above can only imply.
describe("preview frame listener behaviour (shipped source, executed)", () => {
  const ORIGIN = "https://app.imagyn.co";

  async function runListener() {
    const html = await previewHtml();
    const handlerSource = /addEventListener\(\s*"message"\s*,\s*(function\s*\(event\)\s*\{[\s\S]*?\n\s{4}\})\s*\)\s*;/.exec(
      html,
    )?.[1];
    if (!handlerSource) throw new Error("could not extract the message handler from the rendered frame");

    const applied: unknown[] = [];
    const scopes: string[] = [];
    const bodyAttrs: Record<string, string> = {};

    const win = {
      location: { origin: ORIGIN },
      ImagynAppearance: { apply: (tokens: unknown) => applied.push(tokens) },
    };
    const doc = {
      querySelectorAll: () => [] as unknown[],
      body: { setAttribute: (k: string, v: string) => { bodyAttrs[k] = v; } },
    };
    // applyScope is defined alongside the listener in the frame; provide an observable stand-in
    // with the same contract so we can see whether a message got through to it.
    const applyScope = (s: string) => { scopes.push(s || "global"); doc.body.setAttribute("data-imagyn-preview-scope", s || "global"); };

    // eslint-disable-next-line no-new-func
    const handler = new Function("window", "document", "applyScope", `return (${handlerSource});`)(
      win,
      doc,
      applyScope,
    ) as (event: { origin: string; data: unknown }) => void;

    return { handler, applied, scopes, bodyAttrs };
  }

  const draft = { source: "imagyn-appearance-draft", scope: "global", tokens: { colors: { starColor: "#ff0000" } } };

  it("applies a draft posted from its own origin", async () => {
    const { handler, applied, scopes } = await runListener();
    handler({ origin: ORIGIN, data: draft });
    expect(applied).toEqual([draft.tokens]);
    expect(scopes).toEqual(["global"]);
  });

  it("ignores an identical draft posted from a foreign origin", async () => {
    const { handler, applied, scopes } = await runListener();
    handler({ origin: "https://evil.example.com", data: draft });
    expect(applied).toEqual([]);
    expect(scopes).toEqual([]);
  });

  it.each([
    "https://evil.example.com",
    "http://app.imagyn.co", // scheme differs
    "https://app.imagyn.co.evil.com", // suffix attack
    "https://imagyn.co", // parent domain
    "null", // sandboxed/opaque origin
  ])("rejects origin %s", async (origin) => {
    const { handler, applied } = await runListener();
    handler({ origin, data: draft });
    expect(applied).toEqual([]);
  });

  it("ignores a same-origin message that isn't an appearance draft", async () => {
    const { handler, applied } = await runListener();
    handler({ origin: ORIGIN, data: { source: "something-else", tokens: {} } });
    expect(applied).toEqual([]);
  });

  it("ignores a same-origin message with no data at all", async () => {
    const { handler, applied } = await runListener();
    handler({ origin: ORIGIN, data: null });
    expect(applied).toEqual([]);
  });

  it("a rejected foreign message leaves no trace on the frame", async () => {
    const { handler, bodyAttrs } = await runListener();
    handler({ origin: "https://evil.example.com", data: { ...draft, scope: "trust_badge" } });
    expect(bodyAttrs).toEqual({});
  });
});
