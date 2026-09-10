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
