// Exercises app.appearance.tsx's real action — the Global Brand System's "Apply Brand
// Everywhere" CTA and the Surface Override save/reset intents. Regression coverage for the
// Global Brand corrections: Apply Brand Everywhere is a real two-part operation (persist +
// email push), never a relabeled no-op Save; Surface Overrides only ever touch the one
// surface they're saved for.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultAppearanceTokens } from "../services/appearance.shared";

vi.mock("../services/auth-dedupe.server", () => ({
  authenticateAdminDeduped: vi.fn(async () => ({ session: { shop: "store.myshopify.com" } })),
}));

vi.mock("../services/store.server", () => ({
  getOrCreateStore: vi.fn(async () => ({ id: "store_1", name: "Verve" })),
}));

let canUseBrandStudio = true;
vi.mock("../services/permissions", () => ({
  getStorePermissions: vi.fn(async () => ({ canUseBrandStudio })),
  assertPermission: vi.fn((permissions: { canUseBrandStudio: boolean }, key: string, message: string) => {
    if (!permissions.canUseBrandStudio) throw new Error(message);
  }),
}));

const upsertActiveMock = vi.fn(async () => ({}));
vi.mock("../services/appearance.server", () => ({
  appearanceService: {
    getActive: vi.fn(async () => null),
    list: vi.fn(async () => []),
    upsertActive: upsertActiveMock,
  },
}));

const applyBrandingMock = vi.fn(async () => {});
vi.mock("../services/emailTemplate.server", () => ({
  emailTemplateService: { applyBrandingToAllTemplates: applyBrandingMock },
}));

vi.mock("../services/brandSuggestion.server", () => ({ generateAiBrandSuggestion: vi.fn() }));

const setSurfaceOverrideMock = vi.fn(async () => {});
const resetSurfaceOverrideMock = vi.fn(async () => {});
vi.mock("../services/surfaceBrandOverride.server", () => ({
  getSurfaceOverrideTokens: vi.fn(async () => null),
  setSurfaceOverride: setSurfaceOverrideMock,
  resetSurfaceOverride: resetSurfaceOverrideMock,
}));

const { action } = await import("./app.appearance");

function postAction(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return action({ request: new Request("https://example.com/app/appearance", { method: "POST", body: formData }) } as never);
}

beforeEach(() => {
  canUseBrandStudio = true;
  upsertActiveMock.mockClear();
  applyBrandingMock.mockClear();
  setSurfaceOverrideMock.mockClear();
  resetSurfaceOverrideMock.mockClear();
});

describe("applyBrandEverywhere — the main CTA", () => {
  it("performs a real two-part operation: persists the global brand AND pushes it to email templates (Pro)", async () => {
    const tokens = getDefaultAppearanceTokens();
    const result = await postAction({ _intent: "applyBrandEverywhere", tokens: JSON.stringify(tokens), preset: "custom" });

    expect(upsertActiveMock).toHaveBeenCalledWith("store_1", expect.objectContaining({ tokens, preset: "custom" }));
    expect(applyBrandingMock).toHaveBeenCalledWith(
      "store_1",
      expect.objectContaining({ accentColor: tokens.colors.starColor, logoUrl: tokens.images.logoUrl }),
    );
    expect(result).toEqual({ ok: true, intent: "applyBrandEverywhere", emailApplied: true });
  });

  it("still persists the global brand for a Free store, but skips the email push (Pro-gated)", async () => {
    canUseBrandStudio = false;
    const tokens = getDefaultAppearanceTokens();
    const result = await postAction({ _intent: "applyBrandEverywhere", tokens: JSON.stringify(tokens), preset: "custom" });

    expect(upsertActiveMock).toHaveBeenCalled();
    expect(applyBrandingMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, intent: "applyBrandEverywhere", emailApplied: false });
  });
});

describe("saveOverride / resetOverride — Surface-Specific Override", () => {
  it("saves an override for exactly the surface key it was sent for", async () => {
    const result = await postAction({
      _intent: "saveOverride",
      surfaceKey: "store_reviews",
      tokens: JSON.stringify({ colors: { starColor: "#00ff00" } }),
    });

    expect(setSurfaceOverrideMock).toHaveBeenCalledWith("store_1", "store_reviews", { colors: { starColor: "#00ff00" } });
    expect(result).toEqual({
      ok: true,
      intent: "saveOverride",
      surfaceKey: "store_reviews",
      tokens: { colors: { starColor: "#00ff00" } },
    });
  });

  it("rejects an unknown surface key rather than silently accepting it", async () => {
    const result = await postAction({ _intent: "saveOverride", surfaceKey: "not_a_real_surface", tokens: "{}" });
    expect(result).toEqual({ ok: false, intent: "saveOverride", error: "Unknown surface." });
    expect(setSurfaceOverrideMock).not.toHaveBeenCalled();
  });

  it("resets exactly the surface key it was sent for", async () => {
    const result = await postAction({ _intent: "resetOverride", surfaceKey: "trust_badge" });

    expect(resetSurfaceOverrideMock).toHaveBeenCalledWith("store_1", "trust_badge");
    expect(result).toEqual({ ok: true, intent: "resetOverride", surfaceKey: "trust_badge" });
  });
});

// Reset to Defaults. The two scopes are deliberately separate operations, and the property
// that matters most is that neither one reaches past its own scope: a global reset must not
// silently wipe the per-surface overrides a merchant has built up, and a surface reset must
// not touch the global brand or any sibling surface.
describe("Reset to Defaults — global scope", () => {
  it("persists the canonical system defaults, not whatever the client happened to send", async () => {
    const result = await postAction({
      _intent: "reset",
      // A client-supplied payload must be ignored entirely for a reset.
      tokens: JSON.stringify({ colors: { starColor: "#ff0000" } }),
      preset: "custom",
    });

    expect(upsertActiveMock).toHaveBeenCalledWith("store_1", {
      tokens: getDefaultAppearanceTokens(),
      preset: "editorial",
    });
    expect(result).toEqual({
      ok: true,
      intent: "reset",
      tokens: getDefaultAppearanceTokens(),
      preset: "editorial",
    });
  });

  it("does not delete any surface override — an overridden surface keeps its own look", async () => {
    await postAction({ _intent: "reset" });

    expect(resetSurfaceOverrideMock).not.toHaveBeenCalled();
    expect(setSurfaceOverrideMock).not.toHaveBeenCalled();
  });

  it("does not touch email templates — reset is an appearance operation only", async () => {
    await postAction({ _intent: "reset" });

    expect(applyBrandingMock).not.toHaveBeenCalled();
  });

  it("returns tokens the merchant can actually be shown, with every category populated", async () => {
    const result = (await postAction({ _intent: "reset" })) as { tokens: Record<string, unknown> };

    for (const category of Object.keys(getDefaultAppearanceTokens())) {
      expect(result.tokens[category]).toBeDefined();
    }
  });
});

describe("Reset to Defaults — single-surface scope", () => {
  it("removes only that surface's override and leaves the global brand alone", async () => {
    await postAction({ _intent: "resetOverride", surfaceKey: "floating_reviews" });

    expect(resetSurfaceOverrideMock).toHaveBeenCalledTimes(1);
    expect(resetSurfaceOverrideMock).toHaveBeenCalledWith("store_1", "floating_reviews");
    // The global brand is not rewritten as a side effect.
    expect(upsertActiveMock).not.toHaveBeenCalled();
  });

  it("never resets a sibling surface", async () => {
    await postAction({ _intent: "resetOverride", surfaceKey: "trust_badge" });

    const resetKeys = resetSurfaceOverrideMock.mock.calls.map((call) => (call as unknown as [string, string])[1]);
    expect(resetKeys).toEqual(["trust_badge"]);
  });

  it("rejects an unknown surface key instead of resetting something arbitrary", async () => {
    const result = await postAction({ _intent: "resetOverride", surfaceKey: "../all" });

    expect(result).toEqual({ ok: false, intent: "resetOverride", error: "Unknown surface." });
    expect(resetSurfaceOverrideMock).not.toHaveBeenCalled();
  });

  it("stays available to a Free store — reset is not a paid capability", async () => {
    canUseBrandStudio = false;
    const result = (await postAction({ _intent: "resetOverride", surfaceKey: "store_reviews" })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(resetSurfaceOverrideMock).toHaveBeenCalledWith("store_1", "store_reviews");
  });
});
