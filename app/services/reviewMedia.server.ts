import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { ReviewMediaType } from "@prisma/client";
import prisma from "../db.server";
import { ReviewStatus } from "./review.shared";
import { getStorageProvider } from "./storage/provider.server";
import type { StorageContext } from "./storage/types";
import { getStorePermissions } from "./permissions";

export const MAX_IMAGES_PER_REVIEW = 10;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// v1 product rule: exactly one video per review (not a bandwidth/complexity limit like
// MAX_IMAGES_PER_REVIEW — a deliberate, much smaller scope for the first pass).
export const MAX_VIDEOS_PER_REVIEW = 1;
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_DURATION_MS = 60 * 1000;
// The two MIME types real browsers report for these extensions (Safari/most recorders send
// "video/quicktime" for .mov, every browser sends "video/mp4" for .mp4) — not a Shopify API
// concern, just standard file-format MIME conventions.
export const ALLOWED_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"];

export interface ReviewImageFile {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export type ReviewVideoFile = ReviewImageFile;

export interface UploadedReviewMedia {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  type: ReviewMediaType;
}

export interface UploadReviewImagesResult {
  uploaded: UploadedReviewMedia[];
  failed: Array<{ filename: string; error: string }>;
}

// Shared by every caller that reads uploaded review photos out of a multipart FormData
// (app/routes/api.reviews.tsx, app/routes/r.$token.tsx) — one place to change if the
// filename/mimeType fallback or the MAX_IMAGES_PER_REVIEW cap ever needs adjusting.
export async function readImageFilesFromFormData(formData: FormData, fieldName: string): Promise<ReviewImageFile[]> {
  const files: ReviewImageFile[] = [];

  for (const entry of formData.getAll(fieldName)) {
    if (!(entry instanceof File) || entry.size === 0) {
      continue;
    }

    files.push({
      filename: entry.name || "photo",
      mimeType: entry.type || "application/octet-stream",
      buffer: Buffer.from(await entry.arrayBuffer()),
    });
  }

  return files.slice(0, MAX_IMAGES_PER_REVIEW);
}

export function validateImageFile(file: ReviewImageFile): string | null {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimeType)) {
    return `${file.filename}: unsupported file type.`;
  }
  if (file.buffer.byteLength === 0) {
    return `${file.filename}: file is empty.`;
  }
  if (file.buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
    return `${file.filename}: file exceeds the 5MB limit.`;
  }
  return null;
}

// Mirrors readImageFilesFromFormData exactly, just capped to MAX_VIDEOS_PER_REVIEW (1) instead
// of MAX_IMAGES_PER_REVIEW.
export async function readVideoFilesFromFormData(formData: FormData, fieldName: string): Promise<ReviewVideoFile[]> {
  const files: ReviewVideoFile[] = [];

  for (const entry of formData.getAll(fieldName)) {
    if (!(entry instanceof File) || entry.size === 0) {
      continue;
    }

    files.push({
      filename: entry.name || "video",
      mimeType: entry.type || "application/octet-stream",
      buffer: Buffer.from(await entry.arrayBuffer()),
    });
  }

  return files.slice(0, MAX_VIDEOS_PER_REVIEW);
}

// One box (atom) at a time, starting at `start` and stopping at `end` — used both for the
// top-level walk (find "moov") and, one level deeper, for moov's own children (find "mvhd").
// Guards against a corrupt/truncated buffer (out-of-bounds size, size that doesn't advance
// the offset, a runaway box count) by simply stopping and returning whatever was found so
// far, rather than throwing or looping — getVideoDurationMs treats "mvhd not found" the same
// whether the file was merely unusual or genuinely malformed.
interface Mp4Box {
  type: string;
  bodyStart: number;
  bodyEnd: number;
}

function readMp4Boxes(buffer: Buffer, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;
  let iterations = 0;

  while (offset + 8 <= end && iterations < 10_000) {
    iterations += 1;
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);

    let headerLen = 8;
    let boxSize: number;
    if (size32 === 1) {
      if (offset + 16 > end) break;
      boxSize = Number(buffer.readBigUInt64BE(offset + 8));
      headerLen = 16;
    } else if (size32 === 0) {
      boxSize = end - offset;
    } else {
      boxSize = size32;
    }

    if (boxSize < headerLen || offset + boxSize > end) {
      break;
    }

    boxes.push({ type, bodyStart: offset + headerLen, bodyEnd: offset + boxSize });
    offset += boxSize;
  }

  return boxes;
}

// Reads an MP4/MOV file's duration straight out of its "mvhd" (movie header) box —
// ISO/QuickTime base media file format, shared by both containers for this purpose — without
// any external parsing library. Returns null (never throws) for anything that isn't a
// well-formed MP4/MOV with a top-level moov/mvhd box, which validateVideoFile below treats as
// a validation failure, not a silent pass: duration is a hard product limit, so a file whose
// duration can't be verified is rejected rather than assumed to be within bounds.
export function getVideoDurationMs(buffer: Buffer): number | null {
  try {
    const topLevelBoxes = readMp4Boxes(buffer, 0, buffer.length);
    const moov = topLevelBoxes.find((box) => box.type === "moov");
    if (!moov) {
      return null;
    }

    const moovChildren = readMp4Boxes(buffer, moov.bodyStart, moov.bodyEnd);
    const mvhd = moovChildren.find((box) => box.type === "mvhd");
    if (!mvhd) {
      return null;
    }

    const body = mvhd.bodyStart;
    const version = buffer.readUInt8(body);

    // version 0: 4 bytes (version+flags) + 4 (creation) + 4 (modification) -> timescale @ +12
    // version 1: 4 bytes (version+flags) + 8 (creation) + 8 (modification) -> timescale @ +20
    const timescale = version === 1 ? buffer.readUInt32BE(body + 20) : buffer.readUInt32BE(body + 12);
    const rawDuration = version === 1 ? Number(buffer.readBigUInt64BE(body + 24)) : buffer.readUInt32BE(body + 16);

    if (!Number.isFinite(timescale) || timescale <= 0) {
      return null;
    }

    return Math.round((rawDuration / timescale) * 1000);
  } catch {
    return null;
  }
}

// Duration is checked here (before any upload) rather than after — Shopify's own Video.duration
// field is only populated once processing finishes (confirmed against the live schema: null
// until fileStatus is READY), so validating locally first means an over-length video is
// rejected immediately instead of after a wasted upload-and-poll round trip.
export function validateVideoFile(file: ReviewVideoFile): string | null {
  if (!ALLOWED_VIDEO_MIME_TYPES.includes(file.mimeType)) {
    return `${file.filename}: unsupported file type. Use MP4 or MOV.`;
  }
  if (file.buffer.byteLength === 0) {
    return `${file.filename}: file is empty.`;
  }
  if (file.buffer.byteLength > MAX_VIDEO_SIZE_BYTES) {
    return `${file.filename}: file exceeds the 100MB limit.`;
  }

  const durationMs = getVideoDurationMs(file.buffer);
  if (durationMs === null) {
    return `${file.filename}: unable to verify video duration.`;
  }
  if (durationMs > MAX_VIDEO_DURATION_MS) {
    return `${file.filename}: video exceeds the 60 second limit.`;
  }

  return null;
}

// Bounds how many uploads run at once — fast enough to keep total latency reasonable for up
// to MAX_IMAGES_PER_REVIEW files, without firing every stagedUploadsCreate call at Shopify's
// Admin API simultaneously.
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

type FileOutcome =
  | { ok: true; filename: string; media: UploadedReviewMedia }
  | { ok: false; filename: string; error: string };

// Each image is validated, uploaded, and saved independently — one bad file (an oversized
// upload, a storage provider blip) never fails the batch or the review submission it belongs
// to. Callers surface `failed` as a partial-success warning rather than an error.
export async function uploadReviewImages(
  reviewId: string,
  files: ReviewImageFile[],
  admin: AdminApiContext,
): Promise<UploadReviewImagesResult> {
  // Centralized here rather than in each caller (api.reviews.tsx's storefront widget,
  // r.$token.tsx's review-link page) — both submit customer-facing forms where the customer,
  // not the merchant, would otherwise see a plan-upgrade message that means nothing to them.
  // The review itself is unaffected either way; only the photos are declined.
  const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { storeId: true } });
  const permissions = review ? await getStorePermissions(review.storeId) : null;

  if (!permissions || !permissions.canUsePhotoReviews) {
    return {
      uploaded: [],
      failed: files.map((file) => ({ filename: file.filename, error: "Photo reviews are not available on this store's plan." })),
    };
  }

  const provider = getStorageProvider();
  const context: StorageContext = { admin };

  const outcomes = await mapWithConcurrency<ReviewImageFile, FileOutcome>(
    files.slice(0, MAX_IMAGES_PER_REVIEW),
    3,
    async (file): Promise<FileOutcome> => {
      const validationError = validateImageFile(file);
      if (validationError) {
        return { ok: false, filename: file.filename, error: validationError };
      }

      try {
        const uploaded = await provider.uploadImage(
          { buffer: file.buffer, filename: file.filename, mimeType: file.mimeType },
          context,
        );

        const media = await prisma.reviewMedia.create({
          data: {
            reviewId,
            type: ReviewMediaType.IMAGE,
            url: uploaded.url,
            width: uploaded.width,
            height: uploaded.height,
            thumbnailUrl: uploaded.thumbnailUrl,
          },
        });

        return {
          ok: true,
          filename: file.filename,
          media: {
            id: media.id,
            url: media.url,
            thumbnailUrl: media.thumbnailUrl,
            width: media.width,
            height: media.height,
            type: media.type,
          },
        };
      } catch (error) {
        return {
          ok: false,
          filename: file.filename,
          error: error instanceof Error ? error.message : "Upload failed.",
        };
      }
    },
  );

  const uploaded: UploadedReviewMedia[] = [];
  const failed: UploadReviewImagesResult["failed"] = [];

  for (const outcome of outcomes) {
    if (outcome.ok) {
      uploaded.push(outcome.media);
    } else {
      failed.push({ filename: outcome.filename, error: outcome.error });
    }
  }

  return { uploaded, failed };
}

export type UploadReviewVideoResult = UploadReviewImagesResult;

// Same shape and failure-isolation contract as uploadReviewImages above (validate → upload →
// persist, one bad file never fails the review submission it belongs to) — kept as a
// separate function rather than merged into uploadReviewImages because the two differ in
// several real ways: the permission checked (canUseVideoReviews, not canUsePhotoReviews), the
// cap (MAX_VIDEOS_PER_REVIEW, not MAX_IMAGES_PER_REVIEW), the validator, and the storage
// provider method called. In practice `files` is 0 or 1 items — readVideoFilesFromFormData
// already caps it — but this still loops rather than special-casing a single file, so the
// per-file try/catch and failure-isolation behavior stays identical to the image path.
export async function uploadReviewVideos(
  reviewId: string,
  files: ReviewVideoFile[],
  admin: AdminApiContext,
): Promise<UploadReviewVideoResult> {
  const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { storeId: true } });
  const permissions = review ? await getStorePermissions(review.storeId) : null;

  if (!permissions || !permissions.canUseVideoReviews) {
    return {
      uploaded: [],
      failed: files.map((file) => ({ filename: file.filename, error: "Video reviews are not available on this store's plan." })),
    };
  }

  const provider = getStorageProvider();
  const context: StorageContext = { admin };

  const outcomes = await mapWithConcurrency<ReviewVideoFile, FileOutcome>(
    files.slice(0, MAX_VIDEOS_PER_REVIEW),
    1,
    async (file): Promise<FileOutcome> => {
      const validationError = validateVideoFile(file);
      if (validationError) {
        return { ok: false, filename: file.filename, error: validationError };
      }

      try {
        const uploaded = await provider.uploadVideo(
          { buffer: file.buffer, filename: file.filename, mimeType: file.mimeType },
          context,
        );

        const media = await prisma.reviewMedia.create({
          data: {
            reviewId,
            type: ReviewMediaType.VIDEO,
            url: uploaded.url,
            width: uploaded.width,
            height: uploaded.height,
            thumbnailUrl: uploaded.thumbnailUrl,
          },
        });

        return {
          ok: true,
          filename: file.filename,
          media: {
            id: media.id,
            url: media.url,
            thumbnailUrl: media.thumbnailUrl,
            width: media.width,
            height: media.height,
            type: media.type,
          },
        };
      } catch (error) {
        return {
          ok: false,
          filename: file.filename,
          error: error instanceof Error ? error.message : "Upload failed.",
        };
      }
    },
  );

  const uploaded: UploadedReviewMedia[] = [];
  const failed: UploadReviewVideoResult["failed"] = [];

  for (const outcome of outcomes) {
    if (outcome.ok) {
      uploaded.push(outcome.media);
    } else {
      failed.push({ filename: outcome.filename, error: outcome.error });
    }
  }

  return { uploaded, failed };
}

export interface ProductGalleryItem extends UploadedReviewMedia {
  reviewId: string;
}

// The aggregated, product-level "Media Gallery" (all customer photos across every approved
// review for a product, newest first) — distinct from the per-review thumbnail row each
// Review Card renders inline. Only APPROVED, non-deleted reviews contribute, matching every
// other public-facing review query's visibility rule.
export async function getProductMediaGallery(productId: string, limit = 24): Promise<ProductGalleryItem[]> {
  return prisma.reviewMedia.findMany({
    where: {
      review: { productId, deletedAt: null, status: ReviewStatus.APPROVED },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, url: true, thumbnailUrl: true, width: true, height: true, reviewId: true, type: true },
  });
}

// Admin-only moderation action: deletes a single media item independently of its review
// (the review itself, and any other photos on it, are untouched). Scoped through the parent
// review's storeId (ReviewMedia carries no storeId of its own) — a mediaId belonging to
// another store's review resolves to the same "not found" a bogus id would.
export async function deleteReviewMedia(storeId: string, mediaId: string) {
  const media = await prisma.reviewMedia.findFirst({
    where: { id: mediaId, review: { storeId } },
  });

  if (!media) {
    throw new Error("Media not found.");
  }

  await prisma.reviewMedia.delete({ where: { id: mediaId } });

  return media;
}
