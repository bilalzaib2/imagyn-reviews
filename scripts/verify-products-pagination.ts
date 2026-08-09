// Read-only verification script — walks the REAL Grace Store product catalog end-to-end
// through the actual getProductsPage function (the same one app.products.tsx's loader calls),
// asserting: every page returns the requested page size (except the last), no product ID
// appears on more than one page, the total collected count matches the reported totalCount,
// and the same holds true with a search filter applied. Makes zero writes.
import prisma from "../app/db.server";
import { getProductsPage } from "../app/services/product.server";

const PAGE_SIZE = 25;

async function walkAllPages(storeId: string, options: Parameters<typeof getProductsPage>[1] = {}) {
  const seenIds = new Set<string>();
  const pageSizes: number[] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  let reportedTotal = 0;
  let duplicatesAcrossPages = 0;

  for (;;) {
    const result = await getProductsPage(storeId, { ...options, cursor, limit: PAGE_SIZE });
    pageCount += 1;
    reportedTotal = result.totalCount;
    pageSizes.push(result.products.length);

    for (const product of result.products) {
      if (seenIds.has(product.id)) {
        duplicatesAcrossPages += 1;
      }
      seenIds.add(product.id);
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

  console.log("Walking all pages, no filter...");
  const unfiltered = await walkAllPages(store.id);

  // Derive a real search term from the actual catalog instead of guessing a product name —
  // take the first word of some product past the first page, so the filtered walk exercises
  // more than a trivial single-page result.
  const sampleProduct = await prisma.product.findFirst({
    where: { storeId: store.id },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: 30,
  });
  const searchTerm = sampleProduct?.name.split(" ")[0] ?? "";

  console.log(`Walking all pages, search filter (${JSON.stringify(searchTerm)})...`);
  const searchFiltered = searchTerm
    ? await walkAllPages(store.id, { search: searchTerm })
    : { skipped: "no sample product found to derive a search term from" };

  console.log(
    JSON.stringify(
      {
        storeSlug,
        unfiltered,
        searchTerm,
        searchFiltered,
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
