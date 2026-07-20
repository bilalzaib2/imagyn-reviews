import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export interface UploadImageInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface UploadedImage {
  url: string;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
}

// Unlike the AI provider abstraction (a single global API key, resolved once per process),
// a storage provider capable of using Shopify's own Files API needs a per-shop authenticated
// admin client — there is no app-wide credential that works across every merchant's store.
// Context is passed per call rather than baked into the provider at factory time.
export interface StorageContext {
  admin: AdminApiContext;
}

export interface StorageProvider {
  name: string;
  uploadImage(input: UploadImageInput, context: StorageContext): Promise<UploadedImage>;
}

export class StorageProviderError extends Error {
  provider: string;

  constructor(message: string, provider: string) {
    super(message);
    this.name = "StorageProviderError";
    this.provider = provider;
  }
}
