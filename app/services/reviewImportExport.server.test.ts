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
  externalId: string | null;
  reviewerName: string;
  content: string;
  rating: number;
  status: string;
  isPublished: boolean;
  verifiedPurchase: boolean;
  deletedAt: Date | null;
}

let fakeProducts: FakeProduct[];
let fakeReviews: FakeReview[];
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
      update: vi.fn(async () => ({})),
    },
    store: {
      findUnique: vi.fn(async () => ({ plan: "owner" })),
    },
    review: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const match = fakeReviews.find((review) => matchesWhere(review, where));
        return match ? { id: match.id } : null;
      }),
      count: vi.fn(async () => fakeReviews.length),
      aggregate: vi.fn(async () => ({ _avg: { rating: null } })),
      groupBy: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const review: FakeReview = {
          id: `review_${nextReviewId++}`,
          storeId: data.storeId as string,
          productId: data.productId as string,
          externalId: (data.externalId as string | null) ?? null,
          reviewerName: data.reviewerName as string,
          content: data.content as string,
          rating: data.rating as number,
          status: (data.status as string) ?? "PENDING",
          isPublished: (data.isPublished as boolean) ?? false,
          verifiedPurchase: (data.verifiedPurchase as boolean) ?? false,
          deletedAt: null,
        };
        fakeReviews.push(review);
        return review;
      }),
    },
  },
}));

const { importReviews } = await import("./reviewImportExport.server");

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
  nextReviewId = 1;
});

const GENERIC_CSV_HEADER = "product,rating,content,reviewer_name\n";

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

  it("infers verified purchase from source === 'email', not from other sources", async () => {
    seedProduct({ id: "db_7", shopifyProductId: "gid://shopify/Product/1", name: "P1" });

    const csv =
      JUDGEME_HEADER +
      judgemeRow({ body: "Via email", rating: "5", reviewerName: "A", source: "email", productId: "1", metaobjectHandle: "review-email" }) +
      judgemeRow({ body: "Via web widget", rating: "5", reviewerName: "B", source: "web", productId: "1", metaobjectHandle: "review-web" });

    const result = await importReviews("store_1", "judgeme", csv);

    expect(result.imported).toBe(2);
    const viaEmail = fakeReviews.find((r) => r.reviewerName === "A");
    const viaWeb = fakeReviews.find((r) => r.reviewerName === "B");
    expect(viaEmail?.verifiedPurchase).toBe(true);
    expect(viaWeb?.verifiedPurchase).toBe(false);
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
