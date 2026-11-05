// Read-only verification script — walks the REAL Grace Store review dataset end-to-end
// through the actual getStoreReviews function (the same one app.reviews.tsx's loader calls),
// asserting: every page returns the requested page size (except the last), no review ID
// appears on more than one page, the total collected count matches the reported totalCount,
// and the same holds true with a status filter and a search filter applied. Makes zero writes.
import prisma from "../app/db.server";
import { getStoreReviews } from "../app/services/review.server";
import { ReviewStatus } from "../app/services/review.shared";

const PAGE_SIZE = 25;

async function walkAllPages(storeId: string, options: Parameters<typeof getStoreReviews>[1] = {}) {
  const seenIds = new Set<string>();
  const pageSizes: number[] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  let reportedTotal = 0;
  let duplicatesAcrossPages = 0;

  for (;;) {
    const result = await getStoreReviews(storeId, { ...options, cursor, limit: PAGE_SIZE });
    pageCount += 1;
    reportedTotal = result.totalCount;
    pageSizes.push(result.reviews.length);

    for (const review of result.reviews) {
      if (seenIds.has(review.id)) {
        duplicatesAcrossPages += 1;
      }
      seenIds.add(review.id);
    }

    if (!result.hasMore || !result.nextCursor) {
      break;
    }
    cursor = result.nextCursor;

    // Safety valve so a real bug (e.g. an infinite loop from a cursor that never advances)
    // can't hang this script forever.
    if (pageCount > 10000) {
      throw new Error("Exceeded 10,000 pages — likely a pagination bug (cursor not advancing).");
    }
  }

  return {
    pageCount,
    reportedTotal,
    collectedCount: seenIds.size,
    duplicatesAcrossPages,
    firstPageSize: pageSizes[0] ?? 0,
    lastPageSize: pageSizes[pageSizes.length - 1] ?? 0,
    middlePageSize: pageSizes.length > 2 ? pageSizes[Math.floor(pageSizes.length / 2)] : null,
    allFullPagesExceptLastAreCorrectSize: pageSizes.slice(0, -1).every((size) => size === PAGE_SIZE),
  };
}

async function main() {
  const [storeSlug] = process.argv.slice(2);
  const store = await prisma.store.findUnique({ where: { slug: storeSlug } });
  if (!store) {
    console.error(`No store found with slug "${storeSlug}".`);
    process.exit(1);
  }

  console.log("Walking all pages, no filter (newest sort)...");
  const unfiltered = await walkAllPages(store.id, { sort: "newest" });

  console.log("Walking all pages, status=APPROVED filter...");
  const approvedOnly = await walkAllPages(store.id, { status: ReviewStatus.APPROVED, sort: "newest" });

  console.log("Walking all pages, search filter ('embroidered')...");
  const searchFiltered = await walkAllPages(store.id, { search: "embroidered", sort: "newest" });

  console.log("Walking all pages, sort=helpful...");
  const helpfulSort = await walkAllPages(store.id, { sort: "helpful" });

  console.log(
    JSON.stringify(
      {
        storeSlug,
        unfiltered,
        approvedOnly,
        searchFiltered,
        helpfulSort,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
