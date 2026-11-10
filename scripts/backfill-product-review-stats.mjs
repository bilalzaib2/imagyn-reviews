// Recomputes Product.averageRating / totalReviews / ratingNCount from the review table.
//
// WHY A BACKFILL IS NEEDED
//
// Until 2026-11-10, recalculateProductStats counted every live review regardless of
// moderation status, so these five columns included pending and rejected reviews. The fix
// changes what is written from that point on, but it cannot change rows already stored: a
// product whose reviews have not been touched since keeps its inflated figures indefinitely,
// and the merchant's product detail page keeps showing them.
//
// DEFAULTS TO A DRY RUN. With no flags it only reports which products diverge and by how
// much — a read-only operation. Pass --apply to write.
//
// Refuses to run against a non-local database either way: a backfill over every product of
// every store is exactly the kind of sweep that should be run deliberately against production
// by a human who has read what the dry run said, not incidentally by a script.
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

const url = process.env.DATABASE_URL || "";
const host = url.match(/@([^:/?]+)/)?.[1] ?? "";
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(
    `Refusing to run: DATABASE_URL points at "${host || "an unparseable host"}", not a local database.`,
  );
  process.exit(2);
}

const prisma = new PrismaClient();

// Mirrors review.server.ts's LIVE_REVIEW plus the approved status — deliberately written out
// rather than imported, because importing review.server.ts would pull the whole Shopify/AI
// service graph into a maintenance script.
const PUBLIC_SCOPE = { deletedAt: null, archivedAt: null, status: "APPROVED" };

const products = await prisma.product.findMany({
  select: {
    id: true,
    name: true,
    averageRating: true,
    totalReviews: true,
    rating5Count: true,
    rating4Count: true,
    rating3Count: true,
    rating2Count: true,
    rating1Count: true,
  },
});

console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${products.length} products in ${host}\n`);

let diverged = 0;

for (const product of products) {
  const [totalReviews, aggregate, groups] = await Promise.all([
    prisma.review.count({ where: { productId: product.id, ...PUBLIC_SCOPE } }),
    prisma.review.aggregate({ where: { productId: product.id, ...PUBLIC_SCOPE }, _avg: { rating: true } }),
    prisma.review.groupBy({
      by: ["rating"],
      where: { productId: product.id, ...PUBLIC_SCOPE },
      _count: { rating: true },
    }),
  ]);

  const byRating = new Map(groups.map((g) => [g.rating, g._count.rating]));
  const next = {
    totalReviews,
    averageRating: Number((aggregate._avg.rating ?? 0).toFixed(1)),
    rating5Count: byRating.get(5) ?? 0,
    rating4Count: byRating.get(4) ?? 0,
    rating3Count: byRating.get(3) ?? 0,
    rating2Count: byRating.get(2) ?? 0,
    rating1Count: byRating.get(1) ?? 0,
  };

  const changes = Object.entries(next).filter(([key, value]) => product[key] !== value);
  if (changes.length === 0) continue;

  diverged += 1;
  console.log(
    `${product.name.slice(0, 44).padEnd(46)} ` +
      changes.map(([key, value]) => `${key}: ${product[key]} -> ${value}`).join(", "),
  );

  if (APPLY) {
    await prisma.product.update({ where: { id: product.id }, data: next });
  }
}

await prisma.$disconnect();

console.log(`\n${diverged} of ${products.length} products ${APPLY ? "updated" : "would change"}.`);
if (!APPLY && diverged > 0) {
  console.log("Re-run with --apply to write these figures.");
}
