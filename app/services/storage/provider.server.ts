import type { StorageProvider } from "./types";
import { StorageProviderError } from "./types";
import { createShopifyFilesProvider } from "./shopifyFiles.server";

// The only place STORAGE_PROVIDER is read — business logic (reviewMedia.server.ts) and the
// UI never know which concrete provider is in use, matching the AI provider abstraction's
// pattern (app/services/ai/provider.server.ts). "shopify" is the default because it reuses
// this app's existing Admin GraphQL session (see product.server.ts) instead of requiring a
// separate object-storage credential to be provisioned.
export function getStorageProvider(): StorageProvider {
  const providerName = (process.env.STORAGE_PROVIDER || "shopify").toLowerCase();

  switch (providerName) {
    case "shopify":
      return createShopifyFilesProvider();
    default:
      throw new StorageProviderError(`Unrecognized STORAGE_PROVIDER "${providerName}".`, providerName);
  }
}
