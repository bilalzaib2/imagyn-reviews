// Hiding a review records why, and restoring clears it.
//
// This exists because an unexplained hide is a consumer-protection exposure for the app, not
// only the merchant — the same class of risk as the rating-gated rewards removed in
// rewards.server.ts. The failure modes are quiet: a reason that never reaches the database, a
// stale reason left on a restored review, or a bulk action that skips the record a single
// action keeps.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isReviewHideReason,
  parseReviewHideReason,
  REVIEW_HIDE_REASONS,
  reviewHideReasonLabel,
  ReviewStatus,
} from "./review.shared";

describe("the reason vocabulary", () => {
  it("offers a stable, non-empty set of ids", () => {
    expect(REVIEW_HIDE_REASONS.length).toBeGreaterThan(3);
    const ids = REVIEW_HIDE_REASONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers the categories the platform policies name", () => {
    const ids = REVIEW_HIDE_REASONS.map((r) => r.id);
    for (const required of ["spam", "fake", "duplicate", "unrelated"]) {
      expect(ids).toContain(required);
    }
  });

  it("gives every id a human label", () => {
    for (const reason of REVIEW_HIDE_REASONS) {
      expect(reason.label.trim().length).toBeGreaterThan(0);
      expect(reviewHideReasonLabel(reason.id)).toBe(reason.label);
    }
  });

  it("accepts the ids it offers and nothing else", () => {
    expect(isReviewHideReason("spam")).toBe(true);
    for (const bad of ["Spam", "SPAM", "spam lol", "", " ", "drop table", null, undefined, 7, {}]) {
      expect(isReviewHideReason(bad)).toBe(false);
    }
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parseReviewHideReason("  spam  ")).toBe("spam");
  });

  it("returns null for an unoffered reason rather than coercing it to Other", () => {
    // Recording a reason the merchant did not choose puts words in their mouth, in the one
    // record that exists for accountability.
    expect(parseReviewHideReason("something else entirely")).toBeNull();
    expect(parseReviewHideReason(undefined)).toBeNull();
    expect(parseReviewHideReason(null)).toBeNull();
    expect(parseReviewHideReason(123)).toBeNull();
  });

  it("does not leak a raw id as a label", () => {
    expect(reviewHideReasonLabel("not_a_reason")).toBeNull();
  });
});

// ---- service behaviour -------------------------------------------------------------------

const review = {
  id: "rev_1",
  storeId: "store_1",
  productId: "prod_1",
  isPublished: false,
  status: ReviewStatus.PENDING,
};

const update = vi.fn();
const updateMany = vi.fn();
const findFirst = vi.fn();
const findMany = vi.fn();

vi.mock("../db.server", () => ({
  default: {
    review: {
      get findFirst() {
        return findFirst;
      },
      get findMany() {
        return findMany;
      },
      get update() {
        return update;
      },
      get updateMany() {
        return updateMany;
      },
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _avg: { rating: 4 } }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    product: { update: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("./permissions", () => ({
  getStorePermissions: vi.fn().mockResolvedValue({ maxPublishedReviews: null }),
  PermissionError: class extends Error {},
}));
vi.mock("./aiSummary.server", () => ({
  maybeAutoRegenerateAiSummary: vi.fn(),
  maybeAutoRegenerateStoreAiSummary: vi.fn(),
  getAiSummariesForProducts: vi.fn().mockResolvedValue({}),
}));
vi.mock("./store.server", () => ({ getStoreById: vi.fn().mockResolvedValue({ id: "store_1" }) }));
vi.mock("./rewards.server", () => ({ evaluateAndIssueReward: vi.fn() }));
vi.mock("./shopifyFlowTrigger.server", () => ({ notifyReviewCreatedFlowTrigger: vi.fn() }));

const { approveReview, bulkModerateReviews, rejectReview } = await import("./review.server");

/** The `data` the service last handed prisma.review.update. */
const lastUpdateData = () => update.mock.calls[0][0].data;

beforeEach(() => {
  [update, updateMany, findFirst, findMany].forEach((fn) => fn.mockReset());
  findFirst.mockResolvedValue(review);
  findMany.mockResolvedValue([{ id: "rev_1", productId: "prod_1", isPublished: false }]);
  update.mockResolvedValue({ ...review, productId: "prod_1", media: [] });
  updateMany.mockResolvedValue({ count: 1 });
});

describe("hiding a review", () => {
  it("stores the chosen reason and the time it was hidden", async () => {
    await rejectReview("store_1", "rev_1", "spam");

    const data = lastUpdateData();
    expect(data.status).toBe(ReviewStatus.REJECTED);
    expect(data.hiddenReason).toBe("spam");
    expect(data.hiddenAt).toBeInstanceOf(Date);
  });

  it("takes the review off the storefront", async () => {
    await rejectReview("store_1", "rev_1", "fake");
    expect(lastUpdateData().isPublished).toBe(false);
  });

  it("records no reason when none was chosen, rather than inventing one", async () => {
    await rejectReview("store_1", "rev_1");
    const data = lastUpdateData();
    expect(data.hiddenReason).toBeNull();
    // Still stamped: we know when a human hid it even if they gave no category.
    expect(data.hiddenAt).toBeInstanceOf(Date);
  });

  it("refuses to store free text a caller invented", async () => {
    // A hand-crafted POST must not be able to write arbitrary strings into the record.
    await rejectReview("store_1", "rev_1", "<script>alert(1)</script>");
    expect(lastUpdateData().hiddenReason).toBeNull();
  });

  it.each(REVIEW_HIDE_REASONS.map((r) => r.id))("accepts the offered reason %s", async (id) => {
    await rejectReview("store_1", "rev_1", id);
    expect(lastUpdateData().hiddenReason).toBe(id);
  });
});

describe("restoring a review", () => {
  it("clears the reason and the timestamp", async () => {
    // A stale reason would misreport a live review as hidden everywhere the column is read,
    // including any Spam view built over it.
    await approveReview("store_1", "rev_1");

    const data = lastUpdateData();
    expect(data.status).toBe(ReviewStatus.APPROVED);
    expect(data.hiddenReason).toBeNull();
    expect(data.hiddenAt).toBeNull();
    expect(data.isPublished).toBe(true);
  });
});

describe("hiding in bulk", () => {
  it("keeps the same record a single hide keeps", async () => {
    // Otherwise a merchant skips the reason simply by selecting two reviews instead of one.
    await bulkModerateReviews("store_1", ["rev_1"], ReviewStatus.REJECTED, "duplicate");

    const data = updateMany.mock.calls[0][0].data;
    expect(data.hiddenReason).toBe("duplicate");
    expect(data.hiddenAt).toBeInstanceOf(Date);
  });

  it("clears the record when restoring in bulk", async () => {
    await bulkModerateReviews("store_1", ["rev_1"], ReviewStatus.APPROVED);

    const data = updateMany.mock.calls[0][0].data;
    expect(data.hiddenReason).toBeNull();
    expect(data.hiddenAt).toBeNull();
  });

  it("does nothing at all for an empty selection", async () => {
    const result = await bulkModerateReviews("store_1", [], ReviewStatus.REJECTED, "spam");
    expect(result.count).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("tenant isolation", () => {
  it("will not hide a review belonging to another store", async () => {
    findFirst.mockResolvedValue(null);
    await expect(rejectReview("store_2", "rev_1", "spam")).rejects.toThrow("Review not found.");
    expect(update).not.toHaveBeenCalled();
  });

  it("scopes the lookup by store, not by id alone", async () => {
    await rejectReview("store_1", "rev_1", "spam");
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: "rev_1", storeId: "store_1", deletedAt: null });
  });

  it("gives a cross-tenant id the same error a bogus id gets", async () => {
    findFirst.mockResolvedValue(null);
    const cross = await rejectReview("store_2", "rev_1", "spam").catch((e: Error) => e.message);
    const bogus = await rejectReview("store_1", "nope", "spam").catch((e: Error) => e.message);
    expect(cross).toBe(bogus);
  });
});
