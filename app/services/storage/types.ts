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

// Same shape as UploadImageInput — kept as a distinct type rather than a shared alias so the
// two upload methods below read unambiguously at call sites, even though the fields are
// identical today.
export interface UploadVideoInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface UploadedVideo {
  // The direct, playable video URL (Shopify's Video.sources[0].url — see
  // shopifyFiles.server.ts) — distinct from thumbnailUrl below, which is a static poster
  // frame, not something a <video> element's src can play.
  url: string;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
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
  uploadVideo(input: UploadVideoInput, context: StorageContext): Promise<UploadedVideo>;
}

export class StorageProviderError extends Error {
  provider: string;

  constructor(message: string, provider: string) {
    super(message);
    this.name = "StorageProviderError";
    this.provider = provider;
  }
}
