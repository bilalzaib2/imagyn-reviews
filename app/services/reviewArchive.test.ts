// Archiving a review.
//
// Archive is NOT hide, and keeping the two apart is the whole point of these tests. Hiding is
// a moderation verdict and the review stays in the working queue wearing its reason.
// Archiving is filing: the review leaves the queue, the storefront and every statistic, but
// its moderation history is untouched so restoring returns it exactly as it was.
//
// The dangerous failure is silent: a public read or a product statistic that forgets
// `archivedAt` keeps showing and counting an archived review, and nothing throws.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewStatus } from "./review.shared";

const review = {
  id: "rev_1",
  storeId: "store_1",
  productId: "prod_1",
  status: ReviewStatus.APPROVED,
  isPublished: true,
  archivedAt: null as Date | null,
  hiddenReason: null as string | null,
  hiddenAt: null as Date | null,
};

const findFirst = vi.fn();
const findMany = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
const count = vi.fn();
const groupBy = vi.fn();

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
      get count() {
        return count;
      },
      get groupBy() {
        return groupBy;
      },
      aggregate: vi.fn().mockResolvedValue({ _avg: { rating: 4 } }),
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

const svc = await import("./review.server");

const dataOf = (mock: typeof update) => mock.mock.calls[0][0].data;

beforeEach(() => {
  [findFirst, findMany, update, updateMany, count, groupBy].forEach((fn) => fn.mockReset());
  findFirst.mockResolvedValue(review);
  findMany.mockResolvedValue([{ id: "rev_1", productId: "prod_1", status: ReviewStatus.APPROVED }]);
  update.mockResolvedValue({ ...review, media: [] });
  updateMany.mockResolvedValue({ count: 1 });
  count.mockResolvedValue(0);
  groupBy.mockResolvedValue([]);
});

describe("archiving", () => {
  it("stamps archivedAt and takes the review off the storefront", async () => {
    await svc.archiveReview("store_1", "rev_1");

    const data = dataOf(update);
    expect(data.archivedAt).toBeInstanceOf(Date);
    expect(data.isPublished).toBe(false);
  });

  it("preserves the moderation history untouched", async () => {
    // This is the line between archiving and hiding. Archiving is not a verdict, so it must
    // not overwrite one — otherwise restoring cannot put the review back as it was.
    await svc.archiveReview("store_1", "rev_1");

    const data = dataOf(update);
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("hiddenReason");
    expect(data).not.toHaveProperty("hiddenAt");
  });

  it("archives a hidden review without disturbing why it was hidden", async () => {
    findFirst.mockResolvedValue({
      ...review,
      status: ReviewStatus.REJECTED,
      isPublished: false,
      hiddenReason: "spam",
      hiddenAt: new Date(),
    });

    await svc.archiveReview("store_1", "rev_1");
    expect(dataOf(update)).not.toHaveProperty("hiddenReason");
  });

  it("recalculates the product's totals, because the review just left the public set", async () => {
    await svc.archiveReview("store_1", "rev_1");
    expect(count).toHaveBeenCalled();
  });
});

describe("restoring", () => {
  it("clears archivedAt", async () => {
    findFirst.mockResolvedValue({ ...review, archivedAt: new Date() });
    await svc.unarchiveReview("store_1", "rev_1");
    expect(dataOf(update).archivedAt).toBeNull();
  });

  it("republishes a review that was approved when it was archived", async () => {
    findFirst.mockResolvedValue({ ...review, status: ReviewStatus.APPROVED, archivedAt: new Date() });
    await svc.unarchiveReview("store_1", "rev_1");
    expect(dataOf(update).isPublished).toBe(true);
  });

  it.each([
    ["pending", ReviewStatus.PENDING],
    ["rejected", ReviewStatus.REJECTED],
  ])("does NOT republish a review that was %s", async (_label, status) => {
    // Restoring must not promote a review onto the storefront that was never approved.
    findFirst.mockResolvedValue({ ...review, status, archivedAt: new Date() });
    await svc.unarchiveReview("store_1", "rev_1");
    expect(dataOf(update).isPublished).toBe(false);
  });

  it("leaves the moderation history alone on the way back", async () => {
    findFirst.mockResolvedValue({ ...review, status: ReviewStatus.REJECTED, hiddenReason: "fake", archivedAt: new Date() });
    await svc.unarchiveReview("store_1", "rev_1");
    expect(dataOf(update)).not.toHaveProperty("hiddenReason");
  });
});

describe("the Archive is its own view, not another status", () => {
  it("excludes archived reviews from the working queue by default", async () => {
    await svc.getStoreReviews("store_1");
    expect(findMany.mock.calls[0][0].where.archivedAt).toBeNull();
  });

  it("shows only archived reviews when the Archive is asked for", async () => {
    await svc.getStoreReviews("store_1", { archived: true });
    expect(findMany.mock.calls[0][0].where.archivedAt).toEqual({ not: null });
  });

  it("keeps every other filter inside the Archive view", async () => {
    await svc.getStoreReviews("store_1", { archived: true, rating: 5, search: "broken" });
    const where = findMany.mock.calls[0][0].where;
    expect(where.rating).toBe(5);
    expect(JSON.stringify(where)).toContain("broken");
  });

  it("does not force a status, so an archived review keeps the one it had", async () => {
    await svc.getStoreReviews("store_1", { archived: true });
    expect(findMany.mock.calls[0][0].where.status).toBeUndefined();
  });

  it("counts the Archive separately from the working queue", async () => {
    groupBy.mockResolvedValue([{ status: ReviewStatus.APPROVED, _count: { _all: 5 } }]);
    count.mockResolvedValue(3);

    const counts = await svc.getStoreReviewStatusCounts("store_1");
    expect(counts.all).toBe(5);
    expect(counts.archived).toBe(3);
  });

  it("counts the Archive with the same filters as the rest", async () => {
    await svc.getStoreReviewStatusCounts("store_1", { search: "mug" });
    expect(JSON.stringify(count.mock.calls[0][0].where)).toContain("mug");
    expect(count.mock.calls[0][0].where.archivedAt).toEqual({ not: null });
  });
});

describe("bulk archive and restore", () => {
  it("archives every selected review in one update", async () => {
    await svc.bulkSetReviewArchived("store_1", ["rev_1"], true);

    const data = dataOf(updateMany);
    expect(data.archivedAt).toBeInstanceOf(Date);
    expect(data.isPublished).toBe(false);
  });

  it("restores approved and unapproved reviews to different published states", async () => {
    // A single blanket updateMany would either hide approved reviews or publish rejected
    // ones. Neither is acceptable, so the restore splits by the status each review kept.
    findMany.mockResolvedValue([
      { id: "rev_a", productId: "prod_1", status: ReviewStatus.APPROVED },
      { id: "rev_b", productId: "prod_1", status: ReviewStatus.REJECTED },
    ]);

    await svc.bulkSetReviewArchived("store_1", ["rev_a", "rev_b"], false);

    const calls = updateMany.mock.calls.map((call) => call[0]);
    const approved = calls.find((c) => c.where.id.in.includes("rev_a"));
    const rejected = calls.find((c) => c.where.id.in.includes("rev_b"));

    expect(approved.data).toMatchObject({ archivedAt: null, isPublished: true });
    expect(rejected.data).toMatchObject({ archivedAt: null, isPublished: false });
  });

  it("never changes a status in bulk either", async () => {
    await svc.bulkSetReviewArchived("store_1", ["rev_1"], true);
    expect(dataOf(updateMany)).not.toHaveProperty("status");
  });

  it("does nothing for an empty selection", async () => {
    const result = await svc.bulkSetReviewArchived("store_1", [], true);
    expect(result.count).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does nothing when none of the ids belong to this store", async () => {
    findMany.mockResolvedValue([]);
    const result = await svc.bulkSetReviewArchived("store_1", ["rev_other"], true);
    expect(result.count).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("tenant isolation", () => {
  it.each([
    ["archiveReview", () => svc.archiveReview("store_2", "rev_1")],
    ["unarchiveReview", () => svc.unarchiveReview("store_2", "rev_1")],
  ])("%s refuses another store's review", async (_label, call) => {
    findFirst.mockResolvedValue(null);
    await expect(call()).rejects.toThrow("Review not found.");
    expect(update).not.toHaveBeenCalled();
  });

  it("scopes the bulk lookup by store", async () => {
    await svc.bulkSetReviewArchived("store_1", ["rev_1"], true);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ storeId: "store_1", deletedAt: null });
  });

  it("can still resolve an archived review, or it could never be restored", async () => {
    // requireReview must NOT filter on archivedAt.
    const SERVICE = readFileSync("app/services/review.server.ts", "utf8");
    const fn = SERVICE.slice(SERVICE.indexOf("async function requireReview"));
    expect(fn.slice(0, fn.indexOf("}"))).not.toContain("archivedAt");
  });
});

// A source-level guard. These reads are spread across the file and each one fails silently.
describe("archived reviews are invisible everywhere public", () => {
  const SERVICE = readFileSync("app/services/review.server.ts", "utf8");

  it("defines one shared scope rather than repeating the filter", () => {
    // It lives in review.shared.ts, not here: five other services build their own review
    // queries and importing review.server.ts from aiSummary.server.ts (which review.server
    // itself imports) would form a cycle.
    const SHARED = readFileSync("app/services/review.shared.ts", "utf8");
    expect(SHARED).toMatch(/export const LIVE_REVIEW = \{ deletedAt: null, archivedAt: null \}/);
    expect(SERVICE).toMatch(/import \{[^}]*LIVE_REVIEW[^}]*\} from "\.\/review\.shared"/);
  });

  it.each([
    ["app/services/publicDiscovery.server.ts", "the public review network"],
    ["app/services/aiSummary.server.ts", "AI summaries shown to shoppers"],
    ["app/services/trustCertification.server.ts", "the public trust badge"],
    ["app/services/achievements.server.ts", "merchant achievements"],
    ["app/services/analytics.server.ts", "merchant analytics"],
    ["app/services/reviewMedia.server.ts", "storefront media galleries"],
  ])("%s excludes archived reviews from %s", (file) => {
    // Each of these builds its own where clauses and shares none with review.server.ts, so
    // each had to be scoped separately. publicDiscovery was genuinely leaking archived
    // reviews to a consumer-facing network until 2026-11-08.
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/LIVE_REVIEW|archivedAt: null/);
    expect(source).not.toContain("deletedAt: null, status: ReviewStatus.APPROVED");
  });

  it("leaves no public APPROVED read scoped on deletedAt alone", () => {
    // Every storefront read and every statistic pairs deletedAt with status: APPROVED. If one
    // of them still says `deletedAt: null, status: ReviewStatus.APPROVED`, it is counting
    // archived reviews.
    expect(SERVICE).not.toContain("deletedAt: null, status: ReviewStatus.APPROVED");
  });

  it.each([
    ["recalculateProductStats", "product totals"],
    ["getStoreReviewStats", "dashboard statistics"],
    ["getCustomerReviewStatsByEmail", "a customer's own history"],
  ])("%s excludes archived reviews from %s", (fnName) => {
    const start = SERVICE.indexOf(`export async function ${fnName}(`);
    expect(start).toBeGreaterThan(-1);
    const next = SERVICE.indexOf("\nexport ", start + 10);
    const body = SERVICE.slice(start, next === -1 ? undefined : next);
    expect(body).toContain("LIVE_REVIEW");
  });
});
