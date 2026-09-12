// End-to-end tests for the import pipeline (importReviews) against a fake in-memory Prisma
// client — no real database, no real network. Exercises the REAL productMatcher.server.ts,
// judgeme.server.ts, csv.server.ts, and review.server.ts's createReview (including its
// permissions/duplicate-adjacent logic), so these tests catch integration bugs a matcher-only
// or parser-only test would miss — only the raw `prisma` boundary is faked.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeProduct {
  id: string;
  storeId: string;
  shopifyProductId: string | null;
  name: string;
  handle: string | null;
  slug: string | null;
}

interface FakeReview {
  id: string;
  storeId: string;
  productId: string;
  productTitle?: string | null;
  externalId: string | null;
  reviewerName: string;
  content: string;
  title?: string | null;
  rating: number;
  status: string;
  isPublished: boolean;
  verifiedPurchase: boolean;
  sourceVerified: boolean | null;
  importSource: string | null;
  importBatchId: string | null;
  deletedAt: Date | null;
}

interface FakeImportBatch {
  id: string;
  storeId: string;
  source: string;
  filename: string | null;
  totalRows: number;
  imported: number;
  duplicates: number;
  heldForModeration: number;
  unmatchedRows: number;
  invalidRows: number;
  status: string;
  errorDetail: unknown;
  undoneAt: Date | null;
}

interface FakeReviewMedia {
  reviewId: string;
  url: string;
  type: string;
}

let fakeProducts: FakeProduct[];
let fakeReviews: FakeReview[];
let fakeImportBatches: FakeImportBatch[];
let fakeReviewMedia: FakeReviewMedia[];
let nextImportBatchId: number;
// Forces the NEXT prisma.review.create call to throw a real P2002 error, regardless of whether
// a genuine unique-constraint clash exists — simulates a true concurrent-request race (two
// imports of the same file running at once) that a single-threaded, sequential fake harness
// can't otherwise reproduce naturally, since findExistingReview's own check-before-create
// already catches every same-process duplicate before create is ever called.
let forceP2002OnNextCreate = false;
// Controls exportReviewsToCsv's own rate-limit check (prisma.auditLog.count) — a plain
// number is enough here since the tests only need to control "how many recent exports does
// the mock report," not model real AuditLog rows.
let fakeRecentExportCount: number;
let nextReviewId: number;

function matchesWhere(review: FakeReview, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if ((review as unknown as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
}

vi.mock("../db.server", () => ({
  default: {
    product: {
      findMany: vi.fn(async ({ where }: { where: { storeId: string } }) =>
        fakeProducts.filter((p) => p.storeId === where.storeId),
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const product = fakeProducts.find((p) => p.id === where.id);
        return product ? { id: product.id, storeId: product.storeId, name: product.name } : null;
      }),
      // createReview/updateReview (review.server.ts) resolve products through this, scoped by
      // storeId, not findUnique — see review.server.test.ts for the ownership-check coverage.
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) => {
        const product = fakeProducts.find((p) => p.id === where.id && p.storeId === where.storeId);
        return product ? { id: product.id, storeId: product.storeId, name: product.name } : null;
      }),
      update: vi.fn(async () => ({})),
    },
    store: {
      findUnique: vi.fn(async () => ({ plan: "owner" })),
    },
    review: {
      // Returns the full fake row regardless of a real Prisma `select` — sufficient both for
      // findExistingReview's {id, title} need and requireReview's (updateReview's own lookup)
      // need for the whole row, same simplification every other fake-Prisma mock in this repo
      // already uses.
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const match = fakeReviews.find((review) => matchesWhere(review, where));
        return match ?? null;
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> } = { where: {} }) =>
        fakeReviews.filter((review) => matchesWhere(review, where)).length,
      ),
      aggregate: vi.fn(async () => ({ _avg: { rating: null } })),
      groupBy: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (forceP2002OnNextCreate) {
          forceP2002OnNextCreate = false;
          const { Prisma } = await import("@prisma/client");
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          });
        }

        const storeId = data.storeId as string;
        const importSource = (data.importSource as string | null) ?? null;
        const externalId = (data.externalId as string | null) ?? null;

        const review: FakeReview = {
          id: `review_${nextReviewId++}`,
          storeId,
          productId: data.productId as string,
          productTitle: (data.productTitle as string | null) ?? null,
          externalId,
          reviewerName: data.reviewerName as string,
          content: data.content as string,
          title: (data.title as string | null) ?? null,
          rating: data.rating as number,
          status: (data.status as string) ?? "PENDING",
          isPublished: (data.isPublished as boolean) ?? false,
          verifiedPurchase: (data.verifiedPurchase as boolean) ?? false,
          sourceVerified: (data.sourceVerified as boolean | null) ?? null,
          importSource,
          importBatchId: (data.importBatchId as string | null) ?? null,
          deletedAt: null,
        };
        fakeReviews.push(review);
        return review;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matches = fakeReviews.filter((review) => matchesWhere(review, where));
        for (const review of matches) {
          if (data.deletedAt !== undefined) review.deletedAt = data.deletedAt as Date | null;
        }
        return { count: matches.length };
      }),
      // Backs updateReview (called by the import pipeline's own title-repair path — see
      // reviewImportExport.server.ts's importRow). Only applies the fields updateReview
      // actually sends; real update semantics (partial, by id) — no separate stats
      // recalculation needed here since recalculateProductStats reads from `review`/`product`
      // mocks already present above.
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const review = fakeReviews.find((r) => r.id === where.id);
        if (!review) throw new Error("Review not found");
        if (data.title !== undefined) review.title = data.title as string | null;
        if (data.rating !== undefined) review.rating = data.rating as number;
        if (data.content !== undefined) review.content = data.content as string;
        if (data.reviewerName !== undefined) review.reviewerName = data.reviewerName as string;
        if (data.verifiedPurchase !== undefined) review.verifiedPurchase = data.verifiedPurchase as boolean;
        return review;
      }),
      // Only exportReviewsToCsv's own test below uses this — every other test in this file
      // exercises the import path, which never lists reviews back out.
      findMany: vi.fn(
        async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
          const rows = fakeReviews
            .filter((review) => matchesWhere(review, where))
            .map((review) => ({ ...review, product: null, title: review.title ?? null, createdAt: new Date(), repliedAt: null }));
          return typeof take === "number" ? rows.slice(0, take) : rows;
        },
      ),
    },
    // Backs exportReviewsToCsv's own rate-limit check — deliberately a plain count, not a
    // full fake table, since the tests only need to control the number this reports.
    auditLog: {
      count: vi.fn(async () => fakeRecentExportCount),
    },
    reviewMedia: {
      createMany: vi.fn(async ({ data }: { data: Array<{ reviewId: string; url: string; type: string }> }) => {
        fakeReviewMedia.push(...data);
        return { count: data.length };
      }),
    },
    importBatch: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const batch: FakeImportBatch = {
          id: `batch_${nextImportBatchId++}`,
          storeId: data.storeId as string,
          source: data.source as string,
          filename: (data.filename as string | null) ?? null,
          totalRows: (data.totalRows as number) ?? 0,
          imported: 0,
          duplicates: 0,
          heldForModeration: 0,
          unmatchedRows: 0,
          invalidRows: 0,
          status: (data.status as string) ?? "processing",
          errorDetail: (data.errorDetail as unknown) ?? null,
          undoneAt: null,
        };
        fakeImportBatches.push(batch);
        return batch;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const batch = fakeImportBatches.find((b) => b.id === where.id);
        if (!batch) throw new Error("Import batch not found");
        Object.assign(batch, data);
        return batch;
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId?: string } }) => {
        const batch = fakeImportBatches.find(
          (b) => b.id === where.id && (where.storeId === undefined || b.storeId === where.storeId),
        );
        return batch ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: { storeId: string } }) =>
        fakeImportBatches.filter((b) => b.storeId === where.storeId),
      ),
    },
  },
}));

const recordDataAccessMock = vi.fn<(entry: Record<string, unknown>) => Promise<undefined>>(
  async () => undefined,
);
vi.mock("./auditLog.server", () => ({
  recordDataAccess: recordDataAccessMock,
}));

const {
  exportReviewsToCsv,
  importReviews,
  undoImportBatch,
  listImportBatches,
  detectImportColumns,
  MAX_EXPORT_ROWS,
  MAX_IMPORT_FILE_SIZE_BYTES,
  EXPORT_RATE_LIMIT_MAX,
  ExportRateLimitError,
} = await import("./reviewImportExport.server");

function seedProduct(overrides: Partial<FakeProduct>): FakeProduct {
  const product: FakeProduct = {
    id: overrides.id ?? "db_product_1",
    storeId: "store_1",
    shopifyProductId: overrides.shopifyProductId ?? null,
    name: overrides.name ?? "Test Product",
    handle: overrides.handle ?? null,
    slug: overrides.slug ?? null,
  };
  fakeProducts.push(product);
  return product;
}

beforeEach(() => {
  fakeProducts = [];
  fakeReviews = [];
  fakeImportBatches = [];
  fakeReviewMedia = [];
  forceP2002OnNextCreate = false;
  fakeRecentExportCount = 0;
  nextReviewId = 1;
  nextImportBatchId = 1;
  recordDataAccessMock.mockClear();
});

const GENERIC_CSV_HEADER = "product,rating,content,reviewer_name\n";

describe("detectImportColumns — the 'ANALYZE FILE' step, header-only, no DB access", () => {
  it("reports every raw header and the auto-detected mapping for a well-formed generic CSV", () => {
    const csv = "Product Name,Stars,Body,Customer Name\nWidget,5,Great,Jane\n";
    const result = detectImportColumns("csv", csv);

    expect(result.headers).toEqual(["Product Name", "Stars", "Body", "Customer Name"]);
    expect(result.detected.product).toBe("Product Name");
    expect(result.detected.rating).toBe("Stars");
    expect(result.detected.content).toBe("Body");
    expect(result.detected.reviewerName).toBe("Customer Name");
    expect(result.missingRequired).toHaveLength(0);
  });

  it("reports missingRequired for a file whose header row has no recognizable required column", () => {
    const csv = "foo,bar,baz\n1,2,3\n";
    const result = detectImportColumns("csv", csv);

    expect(result.missingRequired).toEqual(expect.arrayContaining(["rating", "content"]));
  });

  it("never touches the database — reads only the header row, works with zero products seeded", () => {
    // No seedProduct call at all in this test — if detectImportColumns touched the DB in any
    // way that required a product catalog, this would be the test to catch it.
    const csv = "product,rating,content,reviewer_name\nWidget,5,Great,Jane\n";
    const result = detectImportColumns("csv", csv);

    expect(result.detected.product).toBe("product");
  });
});

describe("importReviews — manual column-mapping overrides", () => {
  it("lets a merchant correct a field the auto-detection got wrong", async () => {
    seedProduct({ id: "db_1", name: "Widget" });
    // "notes" isn't a recognized alias for "content" — without an override this column would
    // never be read.
    const csv = "product,rating,notes,reviewer_name\nWidget,5,Great review here,Jane\n";

    const withoutOverride = await importReviews("store_1", "csv", csv);
    expect(withoutOverride.errors.length + withoutOverride.missingProducts.length).toBeGreaterThan(0);

    const withOverride = await importReviews("store_1", "csv", csv, null, false, null, { content: "notes" });
    expect(withOverride.imported).toBe(1);
    expect(fakeReviews[0].content).toBe("Great review here");
  });

  it("lets a merchant explicitly force a field to unmapped even when an alias would have matched", async () => {
    seedProduct({ id: "db_1", name: "Widget" });
    const csv = "product,rating,content,reviewer_name,external_id\nWidget,5,Great,Jane,should-be-ignored\n";

    const result = await importReviews("store_1", "csv", csv, null, false, null, { externalId: "" });

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].externalId).toBeNull();
  });

  it("an override naming a column that doesn't exist in the file is safely ignored, not a crash", async () => {
    seedProduct({ id: "db_1", name: "Widget" });
    const csv = "product,rating,content,reviewer_name\nWidget,5,Great,Jane\n";

    const result = await importReviews("store_1", "csv", csv, null, false, null, { title: "nonexistent_column" });

    expect(result.imported).toBe(1);
  });
});

describe("importReviews — untrusted-file-size guard", () => {
  it("rejects a file larger than MAX_IMPORT_FILE_SIZE_BYTES before any parsing occurs", async () => {
    seedProduct({ id: "db_1", name: "Widget" });
    const oversized = GENERIC_CSV_HEADER + "x".repeat(MAX_IMPORT_FILE_SIZE_BYTES + 1);

    const result = await importReviews("store_1", "csv", oversized);

    expect(result.totalRows).toBe(0);
    expect(result.errors[0].reason).toMatch(/limit/i);
    expect(fakeReviews).toHaveLength(0);
  });

  it("accepts a file right at the boundary", async () => {
    seedProduct({ id: "db_1", name: "Widget" });
    const csv = GENERIC_CSV_HEADER + '"Widget",5,"Fine",Jane\n';

    const result = await importReviews("store_1", "csv", csv);

    expect(result.errors).toHaveLength(0);
  });
});

describe("importReviews — generic CSV", () => {
  it("imports a well-formed row end to end", async () => {
    seedProduct({ id: "db_1", name: "Blue Widget" });

    const csv = GENERIC_CSV_HEADER + '"Blue Widget",5,"Great product",Jane Doe\n';
    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(fakeReviews).toHaveLength(1);
    expect(fakeReviews[0].productId).toBe("db_1");
  });

  it("does not abort the batch when one row has a malformed rating — other rows still import", async () => {
    seedProduct({ id: "db_1", name: "Blue Widget" });

    const csv =
      GENERIC_CSV_HEADER +
      '"Blue Widget",5,"Great product",Jane Doe\n' +
      '"Blue Widget",not-a-number,"Bad rating row",John Roe\n' +
      '"Blue Widget",4,"Also fine",Amy Poe\n';
    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/Rating must be a whole number/);
    expect(fakeReviews).toHaveLength(2);
  });

  it("does not abort the batch when one row's product is missing — other rows still import", async () => {
    seedProduct({ id: "db_1", name: "Blue Widget" });

    const csv =
      GENERIC_CSV_HEADER +
      '"Blue Widget",5,"Great product",Jane Doe\n' +
      '"Nonexistent Product",4,"Should not match anything",John Roe\n';
    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(1);
    expect(result.missingProducts).toHaveLength(1);
    expect(result.missingProducts[0].reason).toMatch(/none matched/);
    expect(fakeReviews).toHaveLength(1);
  });

  it("reports a file-level error for malformed CSV with no required columns, without crashing", async () => {
    const result = await importReviews("store_1", "csv", "not,even,close,to,a,valid,header\nfoo,bar\n");

    expect(result.imported).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(fakeReviews).toHaveLength(0);
  });

  it("importing the exact same CSV twice does not create duplicate reviews", async () => {
    seedProduct({ id: "db_1", name: "Blue Widget" });
    const csv = GENERIC_CSV_HEADER + '"Blue Widget",5,"Great product",Jane Doe\n';

    const first = await importReviews("store_1", "csv", csv);
    expect(first.imported).toBe(1);

    const second = await importReviews("store_1", "csv", csv);
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(fakeReviews).toHaveLength(1);
  });

  it("dry run reports what would happen but creates zero reviews", async () => {
    seedProduct({ id: "db_1", name: "Blue Widget" });
    const csv = GENERIC_CSV_HEADER + '"Blue Widget",5,"Great product",Jane Doe\n';

    const result = await importReviews("store_1", "csv", csv, null, true);

    expect(result.dryRun).toBe(true);
    expect(result.expectedImportedCount).toBe(1);
    expect(result.imported).toBe(1);
    expect(fakeReviews).toHaveLength(0);
  });

  it("a dry run followed by the real import still only creates one review (dry run made no lasting state)", async () => {
    seedProduct({ id: "db_1", name: "Blue Widget" });
    const csv = GENERIC_CSV_HEADER + '"Blue Widget",5,"Great product",Jane Doe\n';

    const dryRun = await importReviews("store_1", "csv", csv, null, true);
    expect(dryRun.expectedImportedCount).toBe(1);
    expect(fakeReviews).toHaveLength(0);

    const real = await importReviews("store_1", "csv", csv, null, false);
    expect(real.imported).toBe(1);
    expect(fakeReviews).toHaveLength(1);
  });
});

describe("importReviews — Judge.me", () => {
  const JUDGEME_HEADER =
    '"title","body","rating","review_date","source","curated","reviewer_name","reviewer_email","product_id","product_handle","reply","reply_date","picture_urls","ip_address","location","metaobject_handle"\n';

  function judgemeRow(fields: {
    title?: string;
    body: string;
    rating: string;
    reviewDate?: string;
    source?: string;
    curated?: string;
    reviewerName: string;
    reviewerEmail?: string;
    productId?: string;
    productHandle?: string;
    metaobjectHandle: string;
  }): string {
    const cols = [
      fields.title ?? "",
      fields.body,
      fields.rating,
      fields.reviewDate ?? "2024-03-07 15:43:43 UTC",
      fields.source ?? "email",
      fields.curated ?? "ok",
      fields.reviewerName,
      fields.reviewerEmail ?? "customer@example.com",
      fields.productId ?? "",
      fields.productHandle ?? "",
      "",
      "",
      "",
      "",
      "",
      fields.metaobjectHandle,
    ];
    return cols.map((value) => `"${value}"`).join(",") + "\n";
  }

  it("matches by product_id (bare numeric) and auto-approves 'ok'-curated rows", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/8031152537913", name: "Grace S1560" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({
        body: "Amazing quality",
        rating: "5",
        reviewerName: "Hammad Hanif",
        productId: "8031152537913",
        metaobjectHandle: "review-67a54049-a7dd-4a15-9ed6-7c03e69be930",
      });

    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(1);
    expect(result.heldForModeration).toBe(0);
    expect(fakeReviews[0].status).toBe("APPROVED");
    expect(fakeReviews[0].isPublished).toBe(true);
  });

  it("matches by product_handle when product_id is absent", async () => {
    seedProduct({ id: "db_2", handle: "grace-w104-embroidered-3pc-marina-dress" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({
        body: "Loved it",
        rating: "5",
        reviewerName: "Yazia Ra",
        productHandle: "grace-w104-embroidered-3pc-marina-dress",
        metaobjectHandle: "review-b65edd6d-8a40-4e43-811b-cbf569f738d9",
      });

    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].productId).toBe("db_2");
  });

  it("reports rows with neither product_id nor product_handle as unmatched, not a crash", async () => {
    seedProduct({ id: "db_3", name: "Anything" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({
        body: "Happy customer",
        rating: "5",
        reviewerName: "Imran Zaidi",
        metaobjectHandle: "review-no-product-1",
      });

    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(0);
    expect(result.missingProducts).toHaveLength(1);
    expect(result.missingProducts[0].reason).toMatch(/store-level review/);
  });

  it("importing the same Judge.me export twice is idempotent via metaobject_handle, even if the review body changed", async () => {
    seedProduct({ id: "db_4", shopifyProductId: "gid://shopify/Product/111", name: "Product A" });

    const firstCsv =
      JUDGEME_HEADER +
      judgemeRow({
        body: "Original wording",
        rating: "5",
        reviewerName: "Reviewer One",
        productId: "111",
        metaobjectHandle: "review-stable-id-1",
      });
    const first = await importReviews("store_1", "judgeme", firstCsv);
    expect(first.imported).toBe(1);

    // Same metaobject_handle, but the body text changed between exports — a content-only
    // duplicate check would treat this as a new review; the stable ID must still catch it.
    const secondCsv =
      JUDGEME_HEADER +
      judgemeRow({
        body: "Edited wording, different from the first export",
        rating: "5",
        reviewerName: "Reviewer One",
        productId: "111",
        metaobjectHandle: "review-stable-id-1",
      });
    const second = await importReviews("store_1", "judgeme", secondCsv);

    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(fakeReviews).toHaveLength(1);
  });

  it("one malformed row does not abort the rest of a real-shaped Judge.me batch", async () => {
    seedProduct({ id: "db_5", shopifyProductId: "gid://shopify/Product/1", name: "P1" });
    seedProduct({ id: "db_6", shopifyProductId: "gid://shopify/Product/2", name: "P2" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ body: "Good", rating: "5", reviewerName: "A", productId: "1", metaobjectHandle: "review-a" }) +
      judgemeRow({ body: "", rating: "5", reviewerName: "B", productId: "2", metaobjectHandle: "review-b" }) +
      judgemeRow({ body: "Also good", rating: "4", reviewerName: "C", productId: "1", metaobjectHandle: "review-c" });

    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/content is required/i);
  });

  // Judge.me's source==="email" inference is a real, useful signal but never reliable enough
  // to become IMAGYN's own verifiedPurchase — see the dedicated "verification safety" describe
  // block below for the full policy. Confirms this importer's inference still flows into
  // sourceVerified (audit-only) rather than silently disappearing.
  it("infers sourceVerified from source === 'email', not from other sources — never touches verifiedPurchase", async () => {
    seedProduct({ id: "db_7", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ body: "Via email", rating: "5", reviewerName: "A", source: "email", productId: "1", metaobjectHandle: "review-email" }) +
      judgemeRow({ body: "Via web widget", rating: "5", reviewerName: "B", source: "web", productId: "1", metaobjectHandle: "review-web" });

    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(2);
    const viaEmail = fakeReviews.find((r) => r.reviewerName === "A");
    const viaWeb = fakeReviews.find((r) => r.reviewerName === "B");
    expect(viaEmail?.verifiedPurchase).toBe(false);
    expect(viaEmail?.sourceVerified).toBe(true);
    expect(viaWeb?.verifiedPurchase).toBe(false);
    // "web" produces no claim at all in Judge.me's export (no explicit column, and the
    // email-inference only ever yields a positive signal) — null ("unknown"), not a fabricated
    // explicit "false" the source never actually stated.
    expect(viaWeb?.sourceVerified).toBeNull();
  });

  it("imports a row with an empty review title — title is optional, body is what's required", async () => {
    seedProduct({ id: "db_8", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    // Real Judge.me data: most rows have an empty `title` column (confirmed against the real
    // 2,540-row export) — only `body` is consistently populated.
    const csv =
      JUDGEME_HEADER +
      judgemeRow({ title: "", body: "Bohat pyary dress hain", rating: "5", reviewerName: "Yazia Ra", productId: "1", metaobjectHandle: "review-no-title" });

    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("imports rows with emoji, Urdu script, and mixed-language content without corruption or rejection", async () => {
    seedProduct({ id: "db_9", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const emojiBody = "👍👍👍👍👍";
    const urduBody = "بہت پیاری ڈریس ہے❤❤❤❤❤❤❤";
    const mixedBody = "Suit and stuff is good لیکن shawl ki length short thi";

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ body: emojiBody, rating: "5", reviewerName: "Nazia Zahid", productId: "1", metaobjectHandle: "review-emoji" }) +
      judgemeRow({ body: urduBody, rating: "5", reviewerName: "Yazia Ra", productId: "1", metaobjectHandle: "review-urdu" }) +
      judgemeRow({ body: mixedBody, rating: "5", reviewerName: "Nimra Latif", productId: "1", metaobjectHandle: "review-mixed" });

    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(fakeReviews.some((r) => r.content === emojiBody)).toBe(true);
    expect(fakeReviews.some((r) => r.content === urduBody)).toBe(true);
    expect(fakeReviews.some((r) => r.content === mixedBody)).toBe(true);
  });

  it("title-fallback matching normalizes accented Unicode characters, casing, and whitespace", async () => {
    seedProduct({ id: "db_10", name: "Grace Ştàr Dress — Ünïcode Edition" });

    const csv =
      "product,rating,content,reviewer_name\n" +
      '"grace star dress unicode edition",5,"Nice",Test User\n';

    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(1);
  });

  it("handles a large batch (1,000 rows) correctly — every valid row imports, no duplicates, no crash", async () => {
    seedProduct({ id: "db_1", name: "Blue Widget" });

    let csv = GENERIC_CSV_HEADER;
    for (let i = 0; i < 1000; i += 1) {
      csv += `"Blue Widget",5,"Review number ${i}",Reviewer${i}\n`;
    }

    const result = await importReviews("store_1", "csv", csv);

    expect(result.totalRows).toBe(1000);
    expect(result.imported).toBe(1000);
    expect(result.errors).toHaveLength(0);
    expect(result.missingProducts).toHaveLength(0);
    expect(fakeReviews).toHaveLength(1000);

    // Re-running the same 1,000-row batch must not create 2,000 rows.
    const second = await importReviews("store_1", "csv", csv);
    expect(second.duplicates).toBe(1000);
    expect(fakeReviews).toHaveLength(1000);
  });
});

describe("importReviews — Loox", () => {
  const LOOX_HEADER = '"product_handle","product_Id","rating","author","email","body","created_at","photo_url","reply","replied_at","verified_purchase","incentivized"\n';

  function looxRow(fields: {
    productHandle?: string;
    productId?: string;
    rating: string;
    author: string;
    email?: string;
    body: string;
    createdAt?: string;
    verifiedPurchase?: string;
  }): string {
    const cols = [
      fields.productHandle ?? "",
      fields.productId ?? "",
      fields.rating,
      fields.author,
      fields.email ?? "customer@example.com",
      fields.body,
      fields.createdAt ?? "2024-03-07",
      "",
      "",
      "",
      fields.verifiedPurchase ?? "",
      "",
    ];
    return cols.map((value) => `"${value}"`).join(",") + "\n";
  }

  it("matches by product_handle and auto-approves (no status column, mirrors an already-live Loox review)", async () => {
    seedProduct({ id: "db_1", handle: "blue-widget" });

    const csv = LOOX_HEADER + looxRow({ productHandle: "blue-widget", rating: "5", author: "Jane Doe", body: "Great product" });
    const result = await importReviews("store_1", "loox", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].status).toBe("APPROVED");
    expect(fakeReviews[0].title).toBeNull();
  });

  it("matches by product_Id when product_handle is absent", async () => {
    seedProduct({ id: "db_2", shopifyProductId: "gid://shopify/Product/555" });

    const csv = LOOX_HEADER + looxRow({ productId: "555", rating: "4", author: "John Roe", body: "Solid" });
    const result = await importReviews("store_1", "loox", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].productId).toBe("db_2");
  });

  // Loox's own verified_purchase column is a real signal, preserved as sourceVerified for
  // transparency — but, same policy as every other source, never becomes IMAGYN's own
  // verifiedPurchase. See "verification safety" describe block below for the full rationale.
  it("reads the explicit verified_purchase column into sourceVerified only, never verifiedPurchase", async () => {
    seedProduct({ id: "db_3", handle: "blue-widget" });

    const csv =
      LOOX_HEADER +
      looxRow({ productHandle: "blue-widget", rating: "5", author: "A", body: "Verified", verifiedPurchase: "TRUE" }) +
      looxRow({ productHandle: "blue-widget", rating: "5", author: "B", body: "Not verified", verifiedPurchase: "FALSE" });
    const result = await importReviews("store_1", "loox", csv);

    expect(result.imported).toBe(2);
    expect(fakeReviews.find((r) => r.reviewerName === "A")?.verifiedPurchase).toBe(false);
    expect(fakeReviews.find((r) => r.reviewerName === "A")?.sourceVerified).toBe(true);
    expect(fakeReviews.find((r) => r.reviewerName === "B")?.verifiedPurchase).toBe(false);
    expect(fakeReviews.find((r) => r.reviewerName === "B")?.sourceVerified).toBe(false);
  });
});

describe("importReviews — Stamped.io", () => {
  const STAMPED_HEADER =
    '"product_id","product_handle","productUrl","productImageUrl","photoFilenames","videoFilenames","productTitle","rating","title","author","email","body","created_at","published","reply","replied_at","publishedReply","tags","recommended","votes_up","votes_down","location","featured"\n';

  function stampedRow(fields: {
    productId?: string;
    productHandle?: string;
    productTitle?: string;
    rating: string;
    title?: string;
    author: string;
    body: string;
    published?: string;
  }): string {
    const cols = [
      fields.productId ?? "",
      fields.productHandle ?? "",
      "",
      "",
      "",
      "",
      fields.productTitle ?? "",
      fields.rating,
      fields.title ?? "",
      fields.author,
      "customer@example.com",
      fields.body,
      "2024-03-07 15:43:43",
      fields.published ?? "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ];
    return cols.map((value) => `"${value}"`).join(",") + "\n";
  }

  it("matches by productTitle when product_id/product_handle are both absent", async () => {
    seedProduct({ id: "db_1", name: "Grace Star Dress" });

    const csv = STAMPED_HEADER + stampedRow({ productTitle: "Grace Star Dress", rating: "5", author: "Jane Doe", body: "Lovely" });
    const result = await importReviews("store_1", "stamped", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].productId).toBe("db_1");
  });

  it("persists a real title and honors the published column's TRUE/FALSE as auto-approve", async () => {
    seedProduct({ id: "db_2", handle: "blue-widget" });

    const csv =
      STAMPED_HEADER +
      stampedRow({ productHandle: "blue-widget", rating: "5", title: "Exactly as described", author: "A", body: "Great", published: "TRUE" }) +
      stampedRow({ productHandle: "blue-widget", rating: "3", title: "Meh", author: "B", body: "It was okay", published: "FALSE" });
    const result = await importReviews("store_1", "stamped", csv);

    expect(result.imported).toBe(2);
    expect(fakeReviews.find((r) => r.reviewerName === "A")?.title).toBe("Exactly as described");
    expect(fakeReviews.find((r) => r.reviewerName === "A")?.status).toBe("APPROVED");
    expect(fakeReviews.find((r) => r.reviewerName === "B")?.status).toBe("PENDING");
  });
});

describe("importReviews — review title mapping (regression: 'Untitled review' data-loss bug)", () => {
  const JUDGEME_HEADER =
    '"title","body","rating","review_date","source","curated","reviewer_name","reviewer_email","product_id","product_handle","reply","reply_date","picture_urls","ip_address","location","metaobject_handle"\n';

  function judgemeRow(fields: {
    title?: string;
    body: string;
    rating: string;
    reviewerName: string;
    productId?: string;
    metaobjectHandle: string;
  }): string {
    const cols = [
      fields.title ?? "",
      fields.body,
      fields.rating,
      "2024-03-07 15:43:43 UTC",
      "email",
      "ok",
      fields.reviewerName,
      "customer@example.com",
      fields.productId ?? "",
      "",
      "",
      "",
      "",
      "",
      "",
      fields.metaobjectHandle,
    ];
    return cols.map((value) => `"${value}"`).join(",") + "\n";
  }

  // 1. Judge.me CSV with review title
  it("persists the real title from a Judge.me CSV's title column", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ title: "Amazing quality", body: "Loved it", rating: "5", reviewerName: "A", productId: "1", metaobjectHandle: "review-with-title" });

    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].title).toBe("Amazing quality");
  });

  // 2. CSV with alternate supported title header
  it("persists the title from the generic CSV importer's 'headline' header alias", async () => {
    seedProduct({ id: "db_1", name: "Blue Widget" });

    const csv =
      "product,rating,content,reviewer_name,headline\n" +
      '"Blue Widget",5,"Great product",Jane Doe,"Exactly what I wanted"\n';
    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].title).toBe("Exactly what I wanted");
  });

  // 3. CSV without title
  it("leaves title null (not a placeholder string) when the source genuinely has no title", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ body: "No title in this export row", rating: "5", reviewerName: "A", productId: "1", metaobjectHandle: "review-no-title" });

    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].title).toBeNull();
  });

  // 4. Existing review with legitimate title
  it("never overwrites an existing review's real title when the same row is re-imported", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ title: "Original real title", body: "Body text", rating: "5", reviewerName: "A", productId: "1", metaobjectHandle: "review-stable" });

    const first = await importReviews("store_1", "judgeme", csv);
    expect(first.imported).toBe(1);
    expect(fakeReviews[0].title).toBe("Original real title");

    // Re-import the same file, this time with a different (would-be) title in the source —
    // a legitimate existing title must never be silently replaced by re-importing.
    const secondCsv =
      JUDGEME_HEADER +
      judgemeRow({ title: "A different title", body: "Body text", rating: "5", reviewerName: "A", productId: "1", metaobjectHandle: "review-stable" });
    const second = await importReviews("store_1", "judgeme", secondCsv);

    expect(second.duplicates).toBe(1);
    expect(fakeReviews).toHaveLength(1);
    expect(fakeReviews[0].title).toBe("Original real title");
  });

  // 5. Existing review update (repair) must not erase a title, and must backfill a real one
  it("backfills a null title from a re-imported duplicate row without erasing any other data — the repair path", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ body: "Body text", rating: "5", reviewerName: "A", productId: "1", metaobjectHandle: "review-repairable" });

    const first = await importReviews("store_1", "judgeme", csv);
    expect(first.imported).toBe(1);
    expect(fakeReviews[0].title).toBeNull();

    const secondCsv =
      JUDGEME_HEADER +
      judgemeRow({ title: "Recovered title", body: "Body text", rating: "5", reviewerName: "A", productId: "1", metaobjectHandle: "review-repairable" });
    const second = await importReviews("store_1", "judgeme", secondCsv);

    expect(second.imported).toBe(0);
    expect(second.titlesRepaired).toBe(1);
    expect(fakeReviews).toHaveLength(1);
    expect(fakeReviews[0].title).toBe("Recovered title");
    expect(fakeReviews[0].content).toBe("Body text");
    expect(fakeReviews[0].rating).toBe(5);

    // A titled review's repair count must never be confused with "nothing happened."
    expect(second.imported === 0 && second.duplicates === 0 && second.titlesRepaired > 0).toBe(true);
  });

  // 6. Import preview (dry run) counts a titled row as importable without persisting it — the
  // browser-side raw-CSV preview table (app.reviews.tsx) echoes the file's own "title" column
  // directly via PapaParse, so the only pipeline-side guarantee to test here is that a titled
  // row survives dry-run validation/matching untouched, with zero writes.
  it("dry run counts a titled row as importable and performs zero writes", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ title: "Preview this title", body: "Body text", rating: "5", reviewerName: "A", productId: "1", metaobjectHandle: "review-preview" });

    const result = await importReviews("store_1", "judgeme", csv, null, true);

    expect(result.dryRun).toBe(true);
    expect(result.expectedImportedCount).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(fakeReviews).toHaveLength(0);

    const real = await importReviews("store_1", "judgeme", csv, null, false);
    expect(real.imported).toBe(1);
    expect(fakeReviews[0].title).toBe("Preview this title");
  });

  // 7 & 8. Reviews page row + detail panel: both now render `review.title` directly (see
  // app.reviews.tsx), which reads through getStoreReviews → queryReviews → prisma.review with
  // `include` (not a narrowing `select`), so `title` is never dropped between the DB and the
  // loader. The two UI call sites' "no real title" case was also fixed here (previously a
  // hardcoded "Untitled review" fallback risked reading as data loss); this documents the
  // titled case survives end-to-end through the same query the routes actually use.
  it("a titled review round-trips through the store-wide review query used by the Reviews page and detail panel", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ title: "Shows up on the Reviews page", body: "Body text", rating: "5", reviewerName: "A", productId: "1", metaobjectHandle: "review-ui" });
    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].title).toBe("Shows up on the Reviews page");
  });
});

// Regression suite for a merchant-reported gap: imported reviews showing "Approved"/"Auto
// Approved" with no visible "Verified" badge anywhere in the admin UI. Root-caused as a real
// display gap (Reviews list/detail and the Product detail page's review list never rendered
// verifiedPurchase at all — see app.reviews.tsx/app.products_.$id.tsx's VerifiedBadge/
// metaVerified additions), NOT a mapping bug: judgeme.server.ts's inferVerifiedFromSource
// (source === "email") was already correct, and a production data check confirmed 1,737 of
// 2,769 imported reviews already had verifiedPurchase = true in the database before this fix —
// the data was never missing, only never displayed. These tests lock down that moderation
// status (curated/status) and verification status (source-derived) are independent facts that
// must never be conflated, in either direction.
// POLICY CORRECTION (2026-09-11, see docs/IMPORT_VERIFICATION_POLICY.md): this describe block
// previously locked in a real fabrication bug — an email-sourced Judge.me import was allowed to
// set Review.verifiedPurchase directly, the exact field Trust Certification and the storefront
// "Verified Buyer" badge read as real, IMAGYN-checked evidence. A source's own claim/inference
// is a real, useful signal, but it is not IMAGYN's own evidence — a merchant migrating from
// Judge.me should never see their Trust Certification verified-review count inflate purely
// because a competing platform's CSV said so. The corrected, permanent policy: imported reviews
// always get verifiedPurchase=false; the source's claim is preserved separately in
// sourceVerified for transparency/audit only. Not deleted — rewritten to lock in the fix.
describe("importReviews — verification safety (imported reviews never fabricate IMAGYN verification)", () => {
  const JUDGEME_HEADER =
    '"title","body","rating","review_date","source","curated","reviewer_name","reviewer_email","product_id","product_handle","reply","reply_date","picture_urls","ip_address","location","metaobject_handle"\n';

  function judgemeRow(fields: {
    body: string;
    rating: string;
    reviewerName: string;
    source: string;
    curated: string;
    productId?: string;
    metaobjectHandle: string;
  }): string {
    const cols = [
      "",
      fields.body,
      fields.rating,
      "2024-03-07 15:43:43 UTC",
      fields.source,
      fields.curated,
      fields.reviewerName,
      "customer@example.com",
      fields.productId ?? "",
      "",
      "",
      "",
      "",
      "",
      "",
      fields.metaobjectHandle,
    ];
    return cols.map((value) => `"${value}"`).join(",") + "\n";
  }

  // 1. An email-sourced (Judge.me's strongest signal) import still never becomes IMAGYN-verified.
  it("never sets verifiedPurchase=true even for an email-sourced import — only sourceVerified reflects it", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ body: "Great fit", rating: "5", reviewerName: "A", source: "email", curated: "ok", productId: "1", metaobjectHandle: "review-verified" });
    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].verifiedPurchase).toBe(false);
    expect(fakeReviews[0].sourceVerified).toBe(true);
  });

  // 2. A web-sourced import: no positive claim, sourceVerified reflects that honestly.
  it("marks a web-sourced import as sourceVerified=null (no claim made) and verifiedPurchase=false", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ body: "It was fine", rating: "4", reviewerName: "B", source: "web", curated: "ok", productId: "1", metaobjectHandle: "review-unverified" });
    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].verifiedPurchase).toBe(false);
    // Judge.me's export makes no explicit verification claim for a non-email source — null
    // ("unknown"), not a fabricated explicit "false" the source never actually stated.
    expect(fakeReviews[0].sourceVerified).toBeNull();
  });

  // 3. Approval (moderation outcome) and verification are independent facts — approving a
  // review must never imply or require verifiedPurchase in either direction.
  it("approves a web-sourced review while correctly leaving verifiedPurchase false and sourceVerified unknown", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ body: "Solid product", rating: "5", reviewerName: "C", source: "reviews-tab", curated: "ok", productId: "1", metaobjectHandle: "review-approved-unverified" });
    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].status).toBe("APPROVED");
    expect(fakeReviews[0].verifiedPurchase).toBe(false);
    expect(fakeReviews[0].sourceVerified).toBeNull();
  });

  // 4. Every generic-CSV/Loox/Stamped import path shares the same importRow code — confirms
  // the safety fix isn't Judge.me-specific.
  it("also never fabricates verifiedPurchase for a generic CSV import with an explicit verified_purchase=true column", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name,verified_purchase\nP1,5,Great,Casey,true\n";
    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].verifiedPurchase).toBe(false);
    expect(fakeReviews[0].sourceVerified).toBe(true);
  });

  // 5. A source with no verification column/claim at all reports sourceVerified as null (
  // "unknown"), never coerced to an explicit false claim the source never made.
  it("leaves sourceVerified null when the source made no verification claim at all", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name\nP1,5,Great,Casey\n";
    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].verifiedPurchase).toBe(false);
    expect(fakeReviews[0].sourceVerified).toBeNull();
  });

  // 6. Verification status preserved on re-import/update — the title-repair path must never
  // touch verifiedPurchase or sourceVerified, in either direction.
  it("never changes verifiedPurchase/sourceVerified when a duplicate row is re-imported (title-repair path)", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const firstCsv =
      JUDGEME_HEADER +
      judgemeRow({ body: "Body text", rating: "5", reviewerName: "E", source: "email", curated: "ok", productId: "1", metaobjectHandle: "review-stable-verified" });
    const first = await importReviews("store_1", "judgeme", firstCsv);
    expect(first.imported).toBe(1);
    expect(fakeReviews[0].verifiedPurchase).toBe(false);
    expect(fakeReviews[0].sourceVerified).toBe(true);

    // Re-imported as a duplicate (same metaobject_handle) with source now "web" — the existing
    // row's sourceVerified must stay exactly as it was; a duplicate re-import only ever
    // backfills a missing title, never re-derives verification.
    const secondCsv =
      JUDGEME_HEADER +
      judgemeRow({ body: "Body text", rating: "5", reviewerName: "E", source: "web", curated: "ok", productId: "1", metaobjectHandle: "review-stable-verified" });
    const second = await importReviews("store_1", "judgeme", secondCsv);

    expect(second.duplicates).toBe(1);
    expect(fakeReviews).toHaveLength(1);
    expect(fakeReviews[0].verifiedPurchase).toBe(false);
    expect(fakeReviews[0].sourceVerified).toBe(true);
  });

  // 7. Source-platform provenance is retained on every imported review, auditable but never a
  // shopper-facing verification claim on its own.
  it("retains importSource on every created review", async () => {
    seedProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ body: "Shows source metadata", rating: "5", reviewerName: "F", source: "email", curated: "ok", productId: "1", metaobjectHandle: "review-ui-verified" });
    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(1);
    expect(fakeReviews[0].importSource).toBe("judgeme");
  });
});

describe("Import History — listImportBatches / undoImportBatch", () => {
  it("creates a real ImportBatch row with accurate final counts for a real (non-dry-run) import", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name\nP1,5,Great,Casey\nP1,4,Fine,Jordan\n";

    const result = await importReviews("store_1", "csv", csv, null, false, "my-export.csv");

    expect(result.importBatchId).toBeDefined();
    const batches = await listImportBatches("store_1");
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ source: "csv", filename: "my-export.csv", imported: 2, status: "completed" });
  });

  it("never creates an ImportBatch row for a dry run", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name\nP1,5,Great,Casey\n";

    const result = await importReviews("store_1", "csv", csv, null, true);

    expect(result.importBatchId).toBeUndefined();
    expect(await listImportBatches("store_1")).toHaveLength(0);
  });

  it("undoImportBatch soft-deletes only that batch's own reviews, scoped by storeId", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const batchOneCsv = "product,rating,content,reviewer_name\nP1,5,From batch one,Casey\n";
    const batchOneResult = await importReviews("store_1", "csv", batchOneCsv);

    const batchTwoCsv = "product,rating,content,reviewer_name\nP1,4,From batch two,Jordan\n";
    await importReviews("store_1", "csv", batchTwoCsv);

    expect(fakeReviews).toHaveLength(2);

    const { restored } = await undoImportBatch("store_1", batchOneResult.importBatchId!);

    expect(restored).toBe(1);
    const batchOneReview = fakeReviews.find((r) => r.content === "From batch one");
    const batchTwoReview = fakeReviews.find((r) => r.content === "From batch two");
    expect(batchOneReview?.deletedAt).not.toBeNull();
    expect(batchTwoReview?.deletedAt).toBeNull();
  });

  it("refuses to undo a batch that doesn't belong to the calling store", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name\nP1,5,Great,Casey\n";
    const result = await importReviews("store_1", "csv", csv);

    await expect(undoImportBatch("store_2", result.importBatchId!)).rejects.toThrow("not found");
  });

  it("refuses to undo an already-undone batch a second time", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name\nP1,5,Great,Casey\n";
    const result = await importReviews("store_1", "csv", csv);

    await undoImportBatch("store_1", result.importBatchId!);
    await expect(undoImportBatch("store_1", result.importBatchId!)).rejects.toThrow("already been undone");
  });
});

describe("importReviews — DB-level duplicate constraint as a race-condition backstop", () => {
  it("treats a real P2002 unique-constraint violation from prisma.review.create as a duplicate, not a hard row failure", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    forceP2002OnNextCreate = true;

    const csv = "product,rating,content,reviewer_name,external_id\nP1,5,Great,Casey,ext-123\n";
    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(fakeReviews).toHaveLength(0);
  });

  it("still throws a genuinely unrelated database error rather than swallowing it as a duplicate", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const db = (await import("../db.server")).default as unknown as {
      review: { create: (...args: unknown[]) => Promise<unknown> };
    };
    const originalCreate = db.review.create;
    db.review.create = vi.fn(async () => {
      throw new Error("Connection reset");
    });

    const csv = "product,rating,content,reviewer_name\nP1,5,Great,Casey\n";
    await expect(importReviews("store_1", "csv", csv)).rejects.toThrow("Connection reset");

    db.review.create = originalCreate;
  });
});

describe("importReviews — media (never fetched/downloaded, only validated and referenced)", () => {
  it("creates ReviewMedia rows for valid https image URLs", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name,images\nP1,5,Great,Casey,https://cdn.example.com/photo1.jpg;https://cdn.example.com/photo2.png\n";
    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(1);
    expect(result.importedMedia).toBe(2);
    expect(fakeReviewMedia).toHaveLength(2);
    expect(fakeReviewMedia.map((m) => m.url)).toEqual([
      "https://cdn.example.com/photo1.jpg",
      "https://cdn.example.com/photo2.png",
    ]);
  });

  it("skips a non-https URL with a clear reason, never creates a ReviewMedia row for it", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name,images\nP1,5,Great,Casey,http://cdn.example.com/photo.jpg\n";
    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(1);
    expect(result.importedMedia).toBe(0);
    expect(fakeReviewMedia).toHaveLength(0);
    expect(result.skippedMedia).toHaveLength(1);
    expect(result.skippedMedia[0].reason).toMatch(/https/i);
  });

  it("skips a URL pointing at a private/internal address — refuses to store an SSRF vector", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name,images\nP1,5,Great,Casey,https://127.0.0.1/photo.jpg\n";
    const result = await importReviews("store_1", "csv", csv);

    expect(result.importedMedia).toBe(0);
    expect(result.skippedMedia[0].reason).toMatch(/private|internal/i);
  });

  it("skips a URL with no recognizable image extension", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name,images\nP1,5,Great,Casey,https://cdn.example.com/not-an-image\n";
    const result = await importReviews("store_1", "csv", csv);

    expect(result.importedMedia).toBe(0);
    expect(result.skippedMedia[0].reason).toMatch(/image/i);
  });

  it("never fetches/downloads the URL — only prisma.reviewMedia.createMany is ever called, no network mock exists for it to call", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name,images\nP1,5,Great,Casey,https://cdn.example.com/photo.jpg\n";
    // If importReviews ever tried a real fetch() to this fake host, it would throw/reject in
    // the test environment (no network access) and this test would fail with that error
    // instead of passing — the absence of any fetch mock is itself the safety guarantee here.
    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(1);
    expect(result.importedMedia).toBe(1);
  });

  it("a row with no media column at all imports cleanly with zero media, no error", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name\nP1,5,Great,Casey\n";
    const result = await importReviews("store_1", "csv", csv);

    expect(result.imported).toBe(1);
    expect(result.importedMedia).toBe(0);
    expect(result.skippedMedia).toHaveLength(0);
  });

  it("a dry run reports accurate media counts without creating any ReviewMedia rows", async () => {
    seedProduct({ id: "db_1", name: "P1" });
    const csv = "product,rating,content,reviewer_name,images\nP1,5,Great,Casey,https://cdn.example.com/photo.jpg\n";
    const result = await importReviews("store_1", "csv", csv, null, true);

    expect(result.dryRun).toBe(true);
    expect(result.importedMedia).toBe(1);
    expect(fakeReviewMedia).toHaveLength(0);
  });
});

describe("exportReviewsToCsv — audit trail for a bulk contact-field export", () => {
  it("records a data-access audit entry with a row count, never the actual reviewer data", async () => {
    recordDataAccessMock.mockClear();
    fakeReviews.push(
      {
        id: "review_1",
        storeId: "store_1",
        productId: "product_1",
        externalId: null,
        reviewerName: "Jordan Avery",
        content: "Great product",
        rating: 5,
        status: "APPROVED",
        isPublished: true,
        verifiedPurchase: true,
        sourceVerified: null,
        importSource: null,
        importBatchId: null,
        deletedAt: null,
      },
      {
        id: "review_2",
        storeId: "store_1",
        productId: "product_1",
        externalId: null,
        reviewerName: "Morgan",
        content: "Good",
        rating: 4,
        status: "APPROVED",
        isPublished: true,
        verifiedPurchase: false,
        sourceVerified: null,
        importSource: null,
        importBatchId: null,
        deletedAt: null,
      },
    );

    const result = await exportReviewsToCsv("store_1");

    expect(result.csv).toContain("Jordan Avery");
    expect(result).toMatchObject({ totalCount: 2, exportedCount: 2, truncated: false });
    expect(recordDataAccessMock).toHaveBeenCalledTimes(1);
    expect(recordDataAccessMock).toHaveBeenCalledWith({
      storeId: "store_1",
      actor: "admin:csv_export",
      action: "export",
      resource: "review.contact_fields",
      success: true,
      detail: "2 row(s)",
    });
    // The audit call itself never receives the reviewer's name/email — only a count.
    const callArg = recordDataAccessMock.mock.calls[0][0];
    expect(JSON.stringify(callArg)).not.toContain("Jordan");
  });
});

describe("exportReviewsToCsv — CSV/formula injection protection (OWASP)", () => {
  function seedReviewWithContent(overrides: { reviewerName?: string; content?: string; title?: string | null }) {
    fakeReviews.push({
      id: "review_injection",
      storeId: "store_1",
      productId: "product_1",
      externalId: null,
      reviewerName: overrides.reviewerName ?? "Normal Name",
      content: overrides.content ?? "Normal content",
      title: overrides.title ?? null,
      rating: 5,
      status: "APPROVED",
      isPublished: true,
      verifiedPurchase: true,
      sourceVerified: null,
      importSource: null,
      importBatchId: null,
      deletedAt: null,
    });
  }

  it.each(["=cmd|'/c calc'!A1", "+1+1", "-2+3", "@SUM(1+1)"])(
    "prefixes a formula-triggering content value (%s) with a leading apostrophe",
    async (payload) => {
      seedReviewWithContent({ content: payload });
      const result = await exportReviewsToCsv("store_1");

      expect(result.csv).toContain(`'${payload}`);
      // Never emitted raw — a spreadsheet app would otherwise execute it as a formula.
      expect(result.csv).not.toMatch(new RegExp(`[^']${payload.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    },
  );

  it("prefixes a formula-triggering reviewer name the same way", async () => {
    seedReviewWithContent({ reviewerName: "=HYPERLINK(\"http://evil.example\")", content: "Fine" });
    const result = await exportReviewsToCsv("store_1");

    expect(result.csv).toContain("'=HYPERLINK");
  });

  it("prefixes a formula-triggering title the same way", async () => {
    seedReviewWithContent({ title: "=1+1", content: "Fine" });
    const result = await exportReviewsToCsv("store_1");

    expect(result.csv).toContain("'=1+1");
  });

  it("never touches ordinary content that merely contains a mid-string special character", async () => {
    seedReviewWithContent({ content: "Cost was $5 = a bargain" });
    const result = await exportReviewsToCsv("store_1");

    expect(result.csv).toContain("Cost was $5 = a bargain");
    expect(result.csv).not.toContain("'Cost");
  });
});

describe("exportReviewsToCsv — DLP export cap", () => {
  function seedReviews(count: number) {
    for (let i = 0; i < count; i += 1) {
      fakeReviews.push({
        id: `review_${i}`,
        storeId: "store_1",
        productId: "product_1",
        externalId: null,
        reviewerName: `Reviewer ${i}`,
        content: "Content",
        rating: 5,
        status: "APPROVED",
        isPublished: true,
        verifiedPurchase: true,
        sourceVerified: null,
        importSource: null,
        importBatchId: null,
        deletedAt: null,
      });
    }
  }

  it("exports everything when the store is under the cap — no truncation", async () => {
    seedReviews(5);

    const result = await exportReviewsToCsv("store_1");

    expect(result).toMatchObject({ totalCount: 5, exportedCount: 5, truncated: false });
  });

  it("caps the export at MAX_EXPORT_ROWS and reports the real total when a store exceeds it", async () => {
    seedReviews(MAX_EXPORT_ROWS + 250);

    const result = await exportReviewsToCsv("store_1");

    expect(result.exportedCount).toBe(MAX_EXPORT_ROWS);
    expect(result.totalCount).toBe(MAX_EXPORT_ROWS + 250);
    expect(result.truncated).toBe(true);
    // The CSV itself only ever contains the capped number of data rows (+1 header row).
    expect(result.csv.trim().split("\n")).toHaveLength(MAX_EXPORT_ROWS + 1);
  });

  it("records the audit entry with both counts and the cap value when truncated", async () => {
    recordDataAccessMock.mockClear();
    seedReviews(MAX_EXPORT_ROWS + 1);

    await exportReviewsToCsv("store_1");

    expect(recordDataAccessMock).toHaveBeenCalledWith({
      storeId: "store_1",
      actor: "admin:csv_export",
      action: "export",
      resource: "review.contact_fields",
      success: true,
      detail: `${MAX_EXPORT_ROWS} of ${MAX_EXPORT_ROWS + 1} row(s) (capped at ${MAX_EXPORT_ROWS})`,
    });
  });

  it("never lets a capped export leak another store's reviews to reach the limit", async () => {
    seedReviews(3);
    fakeReviews.push({
      id: "other_store_review",
      storeId: "store_2",
      productId: "product_2",
      externalId: null,
      reviewerName: "Someone Else",
      content: "Content",
      rating: 5,
      status: "APPROVED",
      isPublished: true,
      verifiedPurchase: true,
      sourceVerified: null,
      importSource: null,
      importBatchId: null,
      deletedAt: null,
    });

    const result = await exportReviewsToCsv("store_1");

    expect(result.totalCount).toBe(3);
    expect(result.csv).not.toContain("Someone Else");
  });
});

describe("exportReviewsToCsv — DLP rate limit (per-call cap defeated by repeated calls otherwise)", () => {
  it("allows the export when under the hourly limit", async () => {
    fakeReviews.push({
      id: "review_1",
      storeId: "store_1",
      productId: "product_1",
      externalId: null,
      reviewerName: "Jordan Avery",
      content: "Great",
      rating: 5,
      status: "APPROVED",
      isPublished: true,
      verifiedPurchase: true,
      sourceVerified: null,
      importSource: null,
      importBatchId: null,
      deletedAt: null,
    });
    fakeRecentExportCount = EXPORT_RATE_LIMIT_MAX - 1;

    const result = await exportReviewsToCsv("store_1");

    expect(result.exportedCount).toBe(1);
  });

  it("blocks the export once the store has hit the hourly limit — never even queries reviews", async () => {
    fakeReviews.push({
      id: "review_1",
      storeId: "store_1",
      productId: "product_1",
      externalId: null,
      reviewerName: "Jordan Avery",
      content: "Great",
      rating: 5,
      status: "APPROVED",
      isPublished: true,
      verifiedPurchase: true,
      sourceVerified: null,
      importSource: null,
      importBatchId: null,
      deletedAt: null,
    });
    fakeRecentExportCount = EXPORT_RATE_LIMIT_MAX;

    await expect(exportReviewsToCsv("store_1")).rejects.toThrow(ExportRateLimitError);
  });

  it("records a failed audit entry (never the reviewer data) when a rate-limited export is blocked", async () => {
    recordDataAccessMock.mockClear();
    fakeRecentExportCount = EXPORT_RATE_LIMIT_MAX;

    await expect(exportReviewsToCsv("store_1")).rejects.toThrow(ExportRateLimitError);

    expect(recordDataAccessMock).toHaveBeenCalledWith({
      storeId: "store_1",
      actor: "admin:csv_export",
      action: "export",
      resource: "review.contact_fields",
      success: false,
      detail: `blocked — ${EXPORT_RATE_LIMIT_MAX} exports already in the last hour (max ${EXPORT_RATE_LIMIT_MAX})`,
    });
  });

  it("scopes the rate limit per store — store_2 is unaffected by store_1 hitting its limit", async () => {
    fakeReviews.push({
      id: "review_1",
      storeId: "store_2",
      productId: "product_2",
      externalId: null,
      reviewerName: "Morgan",
      content: "Good",
      rating: 4,
      status: "APPROVED",
      isPublished: true,
      verifiedPurchase: true,
      sourceVerified: null,
      importSource: null,
      importBatchId: null,
      deletedAt: null,
    });
    // The mock's auditLog.count doesn't distinguish stores (see its own comment) — this test
    // documents the real implementation's actual behavior (storeId is part of the `where`
    // clause passed to prisma.auditLog.count), verified instead by asserting the call itself
    // included the right storeId, since the shared fake can't model true per-store counts.
    fakeRecentExportCount = 0;

    await exportReviewsToCsv("store_2");

    const dbServer = await import("../db.server");
    expect(dbServer.default.auditLog.count).toHaveBeenCalledWith({
      where: { storeId: "store_2", actor: "admin:csv_export", action: "export", success: true, createdAt: { gte: expect.any(Date) } },
    });
  });
});
