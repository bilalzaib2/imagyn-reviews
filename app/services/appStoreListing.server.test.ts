// getAppStoreListingUrl is the fix for the "Loving IMAGYN Reviews?" banner's dead button: it
// supplies the real fallback destination for when Shopify declines to show its native review
// modal. The behavior that matters is that it returns Shopify's own URL when there is one, and
// null — never a guessed apps.shopify.com link — in every other case, including failure.
import { describe, expect, it, vi } from "vitest";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { getAppStoreListingUrl } from "./appStoreListing.server";

function adminReturning(body: unknown): AdminApiContext {
  return {
    graphql: vi.fn(async () => ({ json: async () => body })),
  } as unknown as AdminApiContext;
}

describe("getAppStoreListingUrl", () => {
  it("returns the App Store listing URL Shopify reports", async () => {
    const admin = adminReturning({
      data: { currentAppInstallation: { app: { appStoreAppUrl: "https://apps.shopify.com/imagyn-reviews" } } },
    });

    await expect(getAppStoreListingUrl(admin)).resolves.toBe("https://apps.shopify.com/imagyn-reviews");
  });

  it("returns null when the app has no public listing yet, rather than guessing a URL", async () => {
    const admin = adminReturning({
      data: { currentAppInstallation: { app: { appStoreAppUrl: null } } },
    });

    await expect(getAppStoreListingUrl(admin)).resolves.toBeNull();
  });

  it("returns null when the installation or app is missing from the response", async () => {
    await expect(getAppStoreListingUrl(adminReturning({ data: { currentAppInstallation: null } }))).resolves.toBeNull();
    await expect(
      getAppStoreListingUrl(adminReturning({ data: { currentAppInstallation: { app: null } } })),
    ).resolves.toBeNull();
    await expect(getAppStoreListingUrl(adminReturning({}))).resolves.toBeNull();
  });

  it("returns null instead of throwing when the Admin API call fails — a dashboard must still load", async () => {
    const admin = {
      graphql: vi.fn(async () => {
        throw new Error("network down");
      }),
    } as unknown as AdminApiContext;

    await expect(getAppStoreListingUrl(admin)).resolves.toBeNull();
  });

  it("asks Shopify for the listing URL rather than deriving it from the app handle", async () => {
    const admin = adminReturning({
      data: { currentAppInstallation: { app: { appStoreAppUrl: "https://apps.shopify.com/x" } } },
    });

    await getAppStoreListingUrl(admin);

    const query = (admin.graphql as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(query).toContain("currentAppInstallation");
    expect(query).toContain("appStoreAppUrl");
  });
});
