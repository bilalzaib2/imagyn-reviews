import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { ReviewMediaType } from "@prisma/client";
import prisma from "../db.server";
import { ReviewStatus } from "./review.shared";
import { getStorageProvider } from "./storage/provider.server";
import type { StorageContext } from "./storage/types";

export const MAX_IMAGES_PER_REVIEW = 10;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export interface ReviewImageFile {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface UploadedReviewMedia {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface UploadReviewImagesResult {
  uploaded: UploadedReviewMedia[];
  failed: Array<{ filename: string; error: string }>;
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
    select: { id: true, url: true, thumbnailUrl: true, width: true, height: true, reviewId: true },
  });
}

// Admin-only moderation action: deletes a single media item independently of its review
// (the review itself, and any other photos on it, are untouched).
export async function deleteReviewMedia(mediaId: string) {
  const media = await prisma.reviewMedia.findUnique({ where: { id: mediaId } });

  if (!media) {
    throw new Error("Media not found.");
  }

  await prisma.reviewMedia.delete({ where: { id: mediaId } });

  return media;
}
