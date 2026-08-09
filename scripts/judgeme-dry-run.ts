// One-off verification script — NOT part of the build or any npm script. Runs a real
// importReviews(..., dryRun=true) against a real Judge.me export file and a store's real,
// synced product catalog, and prints the full report. dryRun=true means this never calls
// createReview — see reviewImportExport.server.ts's importRow — so this makes zero writes to
// the Review table; it only reads Store/Product rows. Usage:
//
//   railway run --service imagyn-reviews -- npx tsx scripts/judgeme-dry-run.ts <path-to-csv> <store-slug>
import { readFileSync } from "node:fs";
import prisma from "../app/db.server";
import { importReviews } from "../app/services/reviewImportExport.server";

async function main() {
  const [filePath, storeSlug] = process.argv.slice(2);
  if (!filePath || !storeSlug) {
    console.error("Usage: judgeme-dry-run.ts <path-to-csv> <store-slug>");
    process.exit(1);
  }

  const fileContent = readFileSync(filePath, "utf-8");
  const store = await prisma.store.findUnique({ where: { slug: storeSlug } });
  if (!store) {
    console.error(`No store found with slug "${storeSlug}".`);
    process.exit(1);
  }

  const productCount = await prisma.product.count({ where: { storeId: store.id } });

  const result = await importReviews(store.id, "judgeme", fileContent, null, true);

  console.log(
    JSON.stringify(
      {
        storeSlug,
        storeSyncedProductCount: productCount,
        totalRows: result.totalRows,
        matchedRows: result.matchedRows,
        unmatchedRows: result.unmatchedRows,
        duplicateRows: result.duplicateRows,
        invalidRows: result.invalidRows,
        expectedImportedCount: result.expectedImportedCount,
        heldForModeration: result.heldForModeration,
        matchTierCounts: result.matchTierCounts,
        warningsCount: result.warnings.length,
        missingProducts: result.missingProducts,
        errors: result.errors,
        warnings: result.warnings,
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
