// Exercises deleteReviewMedia's storeId ownership check (via the parent review's relation)
// against a fake in-memory Prisma client — no real database. Regression test for the
// cross-tenant media IDOR found in the master feature audit. Also covers the image/video
// upload paths (uploadReviewImages/uploadReviewVideos) and the dependency-free MP4/MOV
// duration parser video validation relies on.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

interface FakeMedia {
  id: string;
  reviewId: string;
  // Not a real ReviewMedia column (see reviewMedia.server.ts's deleteReviewMedia comment —
  // ownership is via the review relation) — kept directly on the fake row purely so this
  // mock's `where: { id, review: { storeId } }` filter has something to compare against.
  storeId: string;
  url: string;
}

let media: FakeMedia[];

interface FakeReview {
  id: string;
  storeId: string;
}

let reviews: FakeReview[];
let createdMedia: Array<{
  id: string;
  reviewId: string;
  type: string;
  url: string;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
}>;
let nextMediaId: number;

vi.mock("../db.server", () => ({
  default: {
    reviewMedia: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; review: { storeId: string } } }) => {
        return media.find((m) => m.id === where.id && m.storeId === where.review.storeId) ?? null;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        media = media.filter((m) => m.id !== where.id);
        return {};
      }),
      create: vi.fn(
        async ({
          data,
        }: {
          data: { reviewId: string; type: string; url: string; width: number | null; height: number | null; thumbnailUrl: string | null };
        }) => {
          const row = { id: `media_${nextMediaId++}`, ...data };
          createdMedia.push(row);
          return row;
        },
      ),
    },
    review: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const review = reviews.find((r) => r.id === where.id);
        return review ? { storeId: review.storeId } : null;
      }),
    },
  },
}));

// Controllable per test, same pattern as aiSummary.server.test.ts/brandSuggestion.server.test.ts
// use for the AI provider abstraction — lets individual tests simulate a successful upload, a
// provider throw (failed upload), etc. without a real Shopify API call.
const uploadImageImpl = vi.fn(async () => ({
  url: "https://cdn.shopify.com/img.jpg",
  width: 800,
  height: 600,
  thumbnailUrl: "https://cdn.shopify.com/img.jpg?width=400",
}));
const uploadVideoImpl = vi.fn(async () => ({
  url: "https://cdn.shopify.com/video.mp4",
  width: 1920,
  height: 1080,
  thumbnailUrl: "https://cdn.shopify.com/poster.jpg?width=400",
  durationMs: 15_000,
}));

vi.mock("./storage/provider.server", () => ({
  getStorageProvider: () => ({
    name: "fake",
    uploadImage: (...args: unknown[]) => (uploadImageImpl as (...a: unknown[]) => unknown)(...args),
    uploadVideo: (...args: unknown[]) => (uploadVideoImpl as (...a: unknown[]) => unknown)(...args),
  }),
}));

// Bypasses the real plan-derivation chain entirely, mocked directly so each test controls
// exactly what canUsePhotoReviews/canUseVideoReviews resolve to — see the "feature disabled"
// tests below for why this is necessary rather than incidental: every real plan currently
// grants canUseVideoReviews: true (permissions.ts), so there is no real plan tier that can
// exercise the "disabled" branch today. This proves uploadReviewVideos's own gate is correct
// regardless of what the current plan tables happen to contain.
let permissionsState = { canUsePhotoReviews: true, canUseVideoReviews: true };

vi.mock("./permissions", () => ({
  getStorePermissions: vi.fn(async () => permissionsState),
}));

const {
  deleteReviewMedia,
  uploadReviewImages,
  uploadReviewVideos,
  validateImageFile,
  validateVideoFile,
  getVideoDurationMs,
} = await import("./reviewMedia.server");

const fakeAdmin = {} as AdminApiContext;

// Builds a minimal, well-formed MP4/MOV byte buffer containing just enough of the box
// structure (ftyp + moov > mvhd) for getVideoDurationMs to compute a real duration from it —
// the same ISO/QuickTime base media format box layout a real recorded video uses, just with
// no actual video/audio track data. version 0 mvhd (32-bit fields) is enough to cover what
// this app's product rules need (a bare few-second-to-two-minute clip); version 1 (64-bit,
// used for very large/long files) is exercised separately below.
function box(type: string, bodyBuffer: Buffer): Buffer {
  const size = 8 + bodyBuffer.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, bodyBuffer]);
}

function buildMp4(timescale: number, durationUnits: number, version: 0 | 1 = 0): Buffer {
  let mvhdBody: Buffer;
  if (version === 1) {
    mvhdBody = Buffer.alloc(32);
    mvhdBody.writeUInt8(1, 0); // version
    mvhdBody.writeBigUInt64BE(0n, 4); // creation_time
    mvhdBody.writeBigUInt64BE(0n, 12); // modification_time
    mvhdBody.writeUInt32BE(timescale, 20);
    mvhdBody.writeBigUInt64BE(BigInt(durationUnits), 24);
  } else {
    mvhdBody = Buffer.alloc(20);
    mvhdBody.writeUInt8(0, 0); // version
    mvhdBody.writeUInt32BE(0, 4); // creation_time
    mvhdBody.writeUInt32BE(0, 8); // modification_time
    mvhdBody.writeUInt32BE(timescale, 12);
    mvhdBody.writeUInt32BE(durationUnits, 16);
  }

  const ftypBody = Buffer.from("isom" + "\0\0\0\0" + "isomiso2mp41", "ascii");
  const ftypBox = box("ftyp", ftypBody);
  const mvhdBox = box("mvhd", mvhdBody);
  const moovBox = box("moov", mvhdBox);
  return Buffer.concat([ftypBox, moovBox]);
}

beforeEach(() => {
  media = [{ id: "media_1", reviewId: "review_1", storeId: "store_2", url: "https://example.com/photo.jpg" }];
  reviews = [{ id: "review_1", storeId: "store_1" }];
  createdMedia = [];
  nextMediaId = 1;
  permissionsState = { canUsePhotoReviews: true, canUseVideoReviews: true };
  uploadImageImpl.mockClear();
  uploadVideoImpl.mockClear();
  uploadImageImpl.mockImplementation(async () => ({
    url: "https://cdn.shopify.com/img.jpg",
    width: 800,
    height: 600,
    thumbnailUrl: "https://cdn.shopify.com/img.jpg?width=400",
  }));
  uploadVideoImpl.mockImplementation(async () => ({
    url: "https://cdn.shopify.com/video.mp4",
    width: 1920,
    height: 1080,
    thumbnailUrl: "https://cdn.shopify.com/poster.jpg?width=400",
    durationMs: 15_000,
  }));
});

describe("deleteReviewMedia — cross-tenant isolation", () => {
  it("rejects a media id whose review belongs to a different store", async () => {
    await expect(deleteReviewMedia("store_1", "media_1")).rejects.toThrow("Media not found.");
    expect(media).toHaveLength(1);
  });

  it("deletes a media id whose review belongs to the caller's own store", async () => {
    const deleted = await deleteReviewMedia("store_2", "media_1");
    expect(deleted.id).toBe("media_1");
    expect(media).toHaveLength(0);
  });

  it("rejects a media id that doesn't exist at all, with the same error as a cross-tenant id", async () => {
    await expect(deleteReviewMedia("store_1", "does_not_exist")).rejects.toThrow("Media not found.");
  });
});

describe("getVideoDurationMs", () => {
  it("reads duration from a version-0 mvhd box", () => {
    // 30000 units at a 1000 timescale = 30 seconds = 30000ms.
    expect(getVideoDurationMs(buildMp4(1000, 30_000))).toBe(30_000);
  });

  it("reads duration from a version-1 (64-bit) mvhd box", () => {
    expect(getVideoDurationMs(buildMp4(1000, 30_000, 1))).toBe(30_000);
  });

  it("returns null for a buffer with no moov/mvhd box at all", () => {
    expect(getVideoDurationMs(Buffer.from("this is not a video file"))).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(getVideoDurationMs(Buffer.alloc(0))).toBeNull();
  });
});

describe("validateImageFile", () => {
  it("accepts a valid image within size limits", () => {
    expect(validateImageFile({ filename: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) })).toBeNull();
  });

  it("rejects an unsupported MIME type", () => {
    const error = validateImageFile({ filename: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(1024) });
    expect(error).toMatch(/unsupported file type/);
  });

  it("rejects an oversized file", () => {
    const error = validateImageFile({ filename: "huge.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(6 * 1024 * 1024) });
    expect(error).toMatch(/5MB limit/);
  });
});

describe("validateVideoFile", () => {
  const validBuffer = buildMp4(1000, 30_000); // 30 seconds

  it("accepts a valid MP4 within size and duration limits", () => {
    expect(validateVideoFile({ filename: "clip.mp4", mimeType: "video/mp4", buffer: validBuffer })).toBeNull();
  });

  it("accepts a valid MOV (video/quicktime) within limits", () => {
    expect(validateVideoFile({ filename: "clip.mov", mimeType: "video/quicktime", buffer: validBuffer })).toBeNull();
  });

  it("rejects an unsupported MIME type", () => {
    const error = validateVideoFile({ filename: "clip.webm", mimeType: "video/webm", buffer: validBuffer });
    expect(error).toMatch(/unsupported file type/);
  });

  it("rejects an oversized file", () => {
    const oversized = Buffer.concat([validBuffer, Buffer.alloc(MAX_VIDEO_SIZE_BYTES_FOR_TEST)]);
    const error = validateVideoFile({ filename: "clip.mp4", mimeType: "video/mp4", buffer: oversized });
    expect(error).toMatch(/100MB limit/);
  });

  it("rejects a video whose parsed duration exceeds 60 seconds", () => {
    const tooLong = buildMp4(1000, 61_000); // 61 seconds
    const error = validateVideoFile({ filename: "clip.mp4", mimeType: "video/mp4", buffer: tooLong });
    expect(error).toMatch(/60 second limit/);
  });

  it("rejects a video whose duration can't be verified, rather than assuming it's within bounds", () => {
    const error = validateVideoFile({ filename: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("garbage") });
    expect(error).toMatch(/unable to verify video duration/);
  });

  it("rejects an empty file", () => {
    const error = validateVideoFile({ filename: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(0) });
    expect(error).toMatch(/empty/);
  });
});

// Kept outside the MAX_VIDEO_SIZE_BYTES import to avoid a second import line purely for a
// test constant — 101MB, one byte over the real 100MB limit.
const MAX_VIDEO_SIZE_BYTES_FOR_TEST = 101 * 1024 * 1024 - 30 /* buildMp4(1000,30000)'s own size */;

describe("uploadReviewImages — valid upload and regression coverage", () => {
  it("uploads a valid image and persists an IMAGE-typed ReviewMedia row", async () => {
    const result = await uploadReviewImages(
      "review_1",
      [{ filename: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) }],
      fakeAdmin,
    );

    expect(result.uploaded).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.uploaded[0].type).toBe("IMAGE");
    expect(uploadImageImpl).toHaveBeenCalledTimes(1);
    expect(createdMedia).toHaveLength(1);
    expect(createdMedia[0].type).toBe("IMAGE");
  });

  it("rejects an unsupported image MIME type without calling the storage provider", async () => {
    const result = await uploadReviewImages(
      "review_1",
      [{ filename: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(1024) }],
      fakeAdmin,
    );

    expect(result.uploaded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toMatch(/unsupported file type/);
    expect(uploadImageImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized image without calling the storage provider", async () => {
    const result = await uploadReviewImages(
      "review_1",
      [{ filename: "huge.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(6 * 1024 * 1024) }],
      fakeAdmin,
    );

    expect(result.failed[0].error).toMatch(/5MB limit/);
    expect(uploadImageImpl).not.toHaveBeenCalled();
  });

  it("returns every file as failed, without calling the storage provider, when canUsePhotoReviews is false", async () => {
    permissionsState = { canUsePhotoReviews: false, canUseVideoReviews: true };

    const result = await uploadReviewImages(
      "review_1",
      [{ filename: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) }],
      fakeAdmin,
    );

    expect(result.uploaded).toHaveLength(0);
    expect(result.failed[0].error).toMatch(/not available on this store's plan/);
    expect(uploadImageImpl).not.toHaveBeenCalled();
  });

  it("isolates a failed upload to that file — a storage provider error never throws out of the function", async () => {
    uploadImageImpl.mockImplementationOnce(async () => {
      throw new Error("Simulated Shopify upload failure");
    });

    const result = await uploadReviewImages(
      "review_1",
      [{ filename: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) }],
      fakeAdmin,
    );

    expect(result.uploaded).toHaveLength(0);
    expect(result.failed[0].error).toBe("Simulated Shopify upload failure");
  });
});

describe("uploadReviewVideos", () => {
  const validVideoFile = { filename: "clip.mp4", mimeType: "video/mp4", buffer: buildMp4(1000, 30_000) };

  it("uploads a valid video and persists a VIDEO-typed ReviewMedia row", async () => {
    const result = await uploadReviewVideos("review_1", [validVideoFile], fakeAdmin);

    expect(result.uploaded).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.uploaded[0].type).toBe("VIDEO");
    expect(uploadVideoImpl).toHaveBeenCalledTimes(1);
    expect(createdMedia).toHaveLength(1);
    expect(createdMedia[0].type).toBe("VIDEO");
  });

  it("rejects an unsupported video MIME type without calling the storage provider", async () => {
    const result = await uploadReviewVideos(
      "review_1",
      [{ filename: "clip.webm", mimeType: "video/webm", buffer: buildMp4(1000, 30_000) }],
      fakeAdmin,
    );

    expect(result.failed[0].error).toMatch(/unsupported file type/);
    expect(uploadVideoImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized video without calling the storage provider", async () => {
    const oversized = Buffer.concat([buildMp4(1000, 30_000), Buffer.alloc(MAX_VIDEO_SIZE_BYTES_FOR_TEST)]);
    const result = await uploadReviewVideos(
      "review_1",
      [{ filename: "huge.mp4", mimeType: "video/mp4", buffer: oversized }],
      fakeAdmin,
    );

    expect(result.failed[0].error).toMatch(/100MB limit/);
    expect(uploadVideoImpl).not.toHaveBeenCalled();
  });

  it("rejects a video over 60 seconds without calling the storage provider", async () => {
    const result = await uploadReviewVideos(
      "review_1",
      [{ filename: "long.mp4", mimeType: "video/mp4", buffer: buildMp4(1000, 90_000) }],
      fakeAdmin,
    );

    expect(result.failed[0].error).toMatch(/60 second limit/);
    expect(uploadVideoImpl).not.toHaveBeenCalled();
  });

  // Exercises the gate itself, not a real plan — see this file's top-level comment on why no
  // current plan tier can reach this branch through the real permission-resolution chain.
  it("returns the file as failed, without calling the storage provider, when canUseVideoReviews is false", async () => {
    permissionsState = { canUsePhotoReviews: true, canUseVideoReviews: false };

    const result = await uploadReviewVideos("review_1", [validVideoFile], fakeAdmin);

    expect(result.uploaded).toHaveLength(0);
    expect(result.failed[0].error).toMatch(/not available on this store's plan/);
    expect(uploadVideoImpl).not.toHaveBeenCalled();
  });

  it("isolates a failed video upload — a storage provider error (e.g. Shopify processing FAILED) never throws out of the function", async () => {
    uploadVideoImpl.mockImplementationOnce(async () => {
      throw new Error("Shopify failed to process the uploaded file.");
    });

    const result = await uploadReviewVideos("review_1", [validVideoFile], fakeAdmin);

    expect(result.uploaded).toHaveLength(0);
    expect(result.failed[0].error).toBe("Shopify failed to process the uploaded file.");
  });
});

describe("mixed image/video media on the same review", () => {
  it("persists both an IMAGE and a VIDEO row for the same reviewId, independently", async () => {
    const imageResult = await uploadReviewImages(
      "review_1",
      [{ filename: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) }],
      fakeAdmin,
    );
    const videoResult = await uploadReviewVideos(
      "review_1",
      [{ filename: "clip.mp4", mimeType: "video/mp4", buffer: buildMp4(1000, 30_000) }],
      fakeAdmin,
    );

    expect(imageResult.uploaded).toHaveLength(1);
    expect(videoResult.uploaded).toHaveLength(1);
    expect(createdMedia).toHaveLength(2);
    expect(createdMedia.filter((m) => m.reviewId === "review_1" && m.type === "IMAGE")).toHaveLength(1);
    expect(createdMedia.filter((m) => m.reviewId === "review_1" && m.type === "VIDEO")).toHaveLength(1);
  });
});
