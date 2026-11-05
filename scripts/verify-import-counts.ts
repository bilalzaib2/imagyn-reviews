// Read-only verification script — no writes. Reports exactly how many reviews exist for a
// store, how many carry a Judge.me externalId (i.e. came from the import), how many predate
// the import, and the overall creation-time distribution, so the exact math behind the total
// count is verifiable rather than assumed.
import prisma from "../app/db.server";

async function main() {
  const [storeSlug] = process.argv.slice(2);
  if (!storeSlug) {
    console.error("Usage: verify-import-counts.ts <store-slug>");
    process.exit(1);
  }

  const store = await prisma.store.findUnique({ where: { slug: storeSlug } });
  if (!store) {
    console.error(`No store found with slug "${storeSlug}".`);
    process.exit(1);
  }

  const totalReviews = await prisma.review.count({ where: { storeId: store.id, deletedAt: null } });
  const withExternalId = await prisma.review.count({
    where: { storeId: store.id, deletedAt: null, externalId: { not: null } },
  });
  const withoutExternalId = totalReviews - withExternalId;

  const earliestJudgeme = await prisma.review.findFirst({
    where: { storeId: store.id, deletedAt: null, externalId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  const preExisting = await prisma.review.findMany({
    where: { storeId: store.id, deletedAt: null, externalId: null },
    select: { id: true, reviewerName: true, content: true, createdAt: true, productId: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const duplicateExternalIds = await prisma.review.groupBy({
    by: ["externalId"],
    where: { storeId: store.id, deletedAt: null, externalId: { not: null } },
    _count: { externalId: true },
    having: { externalId: { _count: { gt: 1 } } },
  });

  console.log(
    JSON.stringify(
      {
        storeSlug,
        totalReviews,
        withExternalId,
        withoutExternalId,
        earliestJudgemeReviewCreatedAt: earliestJudgeme?.createdAt ?? null,
        duplicateExternalIdGroups: duplicateExternalIds.length,
        duplicateExternalIdSamples: duplicateExternalIds.slice(0, 5),
        preExistingReviewsSample: preExisting.map((r) => ({
          id: r.id,
          reviewerName: r.reviewerName,
          contentPreview: r.content.slice(0, 60),
          createdAt: r.createdAt,
        })),
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
