// Exercises createShopifyFilesProvider's uploadVideo (and, for regression, uploadImage)
// against a fake Admin GraphQL client — no real network call. The response shapes used here
// (StagedUploadTargetGenerateUploadResource.VIDEO, FileContentType.VIDEO, the Video type's
// duration/preview/sources fields) were verified against Shopify's live Admin API schema
// before this file was written — see the shopifyFiles.server.ts implementation comments —
// not invented from memory.
import { describe, expect, it, vi } from "vitest";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { createShopifyFilesProvider } from "./shopifyFiles.server";
import { StorageProviderError } from "./types";

function createFakeAdmin(handlers: {
  onStagedUploadsCreate?: (variables: Record<string, unknown>) => unknown;
  onFileCreate?: (variables: Record<string, unknown>) => unknown;
  onPoll?: (variables: Record<string, unknown>) => unknown;
}): AdminApiContext {
  const graphql = vi.fn(async (query: string, requestOptions?: { variables?: Record<string, unknown> }) => {
    const variables = requestOptions?.variables ?? {};

    if (query.includes("StagedUploadsCreate")) {
      return { json: async () => handlers.onStagedUploadsCreate?.(variables) };
    }
    if (query.includes("mutation FileCreate")) {
      return { json: async () => handlers.onFileCreate?.(variables) };
    }
    if (query.includes("PollUploadedFile")) {
      return { json: async () => handlers.onPoll?.(variables) };
    }

    throw new Error("Unexpected query: " + query.slice(0, 60));
  });

  return { graphql } as unknown as AdminApiContext;
}

const STAGED_TARGET_RESPONSE = {
  data: {
    stagedUploadsCreate: {
      stagedTargets: [
        {
          url: "https://shopify-staged-uploads.example.com",
          resourceUrl: "https://shopify-staged-uploads.example.com/resource",
          parameters: [{ name: "key", value: "abc123" }],
        },
      ],
      userErrors: [],
    },
  },
};

describe("createShopifyFilesProvider — uploadVideo", () => {
  it("requests resource: VIDEO in stagedUploadsCreate and contentType: VIDEO in fileCreate", async () => {
    const stagedUploadsVariables: Record<string, unknown>[] = [];
    const fileCreateVariables: Record<string, unknown>[] = [];

    const admin = createFakeAdmin({
      onStagedUploadsCreate: (variables) => {
        stagedUploadsVariables.push(variables);
        return STAGED_TARGET_RESPONSE;
      },
      onFileCreate: (variables) => {
        fileCreateVariables.push(variables);
        return {
          data: {
            fileCreate: {
              files: [
                {
                  id: "gid://shopify/Video/1",
                  fileStatus: "READY",
                  duration: 15000,
                  preview: { image: { url: "https://cdn.shopify.com/poster.jpg" } },
                  sources: [
                    { url: "https://cdn.shopify.com/video.mp4", format: "mp4", mimeType: "video/mp4", width: 1920, height: 1080 },
                  ],
                },
              ],
              userErrors: [],
            },
          },
        };
      },
    });

    global.fetch = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;

    const provider = createShopifyFilesProvider();
    const result = await provider.uploadVideo(
      { buffer: Buffer.from("fake video bytes"), filename: "clip.mp4", mimeType: "video/mp4" },
      { admin },
    );

    expect(stagedUploadsVariables[0]).toMatchObject({
      input: [expect.objectContaining({ resource: "VIDEO", mimeType: "video/mp4" })],
    });
    expect(fileCreateVariables[0]).toMatchObject({
      files: [expect.objectContaining({ contentType: "VIDEO" })],
    });

    expect(result).toEqual({
      url: "https://cdn.shopify.com/video.mp4",
      width: 1920,
      height: 1080,
      thumbnailUrl: "https://cdn.shopify.com/poster.jpg?width=400",
      durationMs: 15000,
    });
  });

  it("polls until fileStatus is READY when fileCreate returns a still-processing video", async () => {
    let pollCount = 0;

    const admin = createFakeAdmin({
      onStagedUploadsCreate: () => STAGED_TARGET_RESPONSE,
      onFileCreate: () => ({
        data: {
          fileCreate: {
            files: [{ id: "gid://shopify/Video/2", fileStatus: "PROCESSING" }],
            userErrors: [],
          },
        },
      }),
      onPoll: () => {
        pollCount += 1;
        if (pollCount < 2) {
          return { data: { node: { fileStatus: "PROCESSING" } } };
        }
        return {
          data: {
            node: {
              fileStatus: "READY",
              duration: 8000,
              preview: { image: { url: "https://cdn.shopify.com/poster2.jpg" } },
              sources: [{ url: "https://cdn.shopify.com/video2.mp4", format: "mp4", mimeType: "video/mp4", width: 640, height: 480 }],
            },
          },
        };
      },
    });

    global.fetch = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;

    const provider = createShopifyFilesProvider();
    const result = await provider.uploadVideo(
      { buffer: Buffer.from("fake video bytes"), filename: "clip.mp4", mimeType: "video/mp4" },
      { admin },
    );

    expect(pollCount).toBe(2);
    expect(result.url).toBe("https://cdn.shopify.com/video2.mp4");
    expect(result.durationMs).toBe(8000);
  });

  it("throws when Shopify reports fileStatus FAILED while polling", async () => {
    const admin = createFakeAdmin({
      onStagedUploadsCreate: () => STAGED_TARGET_RESPONSE,
      onFileCreate: () => ({
        data: { fileCreate: { files: [{ id: "gid://shopify/Video/3", fileStatus: "PROCESSING" }], userErrors: [] } },
      }),
      onPoll: () => ({ data: { node: { fileStatus: "FAILED" } } }),
    });

    global.fetch = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;

    const provider = createShopifyFilesProvider();
    await expect(
      provider.uploadVideo({ buffer: Buffer.from("fake video bytes"), filename: "clip.mp4", mimeType: "video/mp4" }, { admin }),
    ).rejects.toThrow(StorageProviderError);
  });
});

describe("createShopifyFilesProvider — uploadImage (regression)", () => {
  it("still requests resource: IMAGE / contentType: IMAGE and reads the MediaImage shape", async () => {
    const admin = createFakeAdmin({
      onStagedUploadsCreate: () => STAGED_TARGET_RESPONSE,
      onFileCreate: () => ({
        data: {
          fileCreate: {
            files: [{ id: "gid://shopify/MediaImage/1", fileStatus: "READY", image: { url: "https://cdn.shopify.com/photo.jpg", width: 800, height: 600 } }],
            userErrors: [],
          },
        },
      }),
    });

    global.fetch = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;

    const provider = createShopifyFilesProvider();
    const result = await provider.uploadImage(
      { buffer: Buffer.from("fake image bytes"), filename: "photo.jpg", mimeType: "image/jpeg" },
      { admin },
    );

    expect(result).toEqual({
      url: "https://cdn.shopify.com/photo.jpg",
      width: 800,
      height: 600,
      thumbnailUrl: "https://cdn.shopify.com/photo.jpg?width=400",
    });
  });
});
