// Exercises deleteReviewMedia's storeId ownership check (via the parent review's relation)
// against a fake in-memory Prisma client — no real database. Regression test for the
// cross-tenant media IDOR found in the master feature audit.
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    },
  },
}));

const { deleteReviewMedia } = await import("./reviewMedia.server");

beforeEach(() => {
  media = [{ id: "media_1", reviewId: "review_1", storeId: "store_2", url: "https://example.com/photo.jpg" }];
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
