// Read-only — checks whether the 11 product_id/handle pairs the earlier dry run reported as
// unmatched now resolve against the current product catalog (e.g. because product sync ran
// again between the dry run and the real import).
import prisma from "../app/db.server";
import { toProductGid } from "../app/services/product.server";

const PREVIOUSLY_UNMATCHED: Array<{ row: number; productId: string; productHandle: string }> = [
  { row: 502, productId: "43029495833", productHandle: "ethnic-727-blue-embroided-3pc-linen-dress-with-cotton-brosha-dupatta" },
  { row: 503, productId: "1312335298674", productHandle: "nishat-d-810" },
  { row: 504, productId: "1297048633458", productHandle: "maria-white" },
  { row: 505, productId: "1310022991986", productHandle: "zainab-chottani-120584" },
  { row: 506, productId: "1565838344278", productHandle: "gul-ahmad-d-062" },
  { row: 507, productId: "1938742411350", productHandle: "bareeze-d070" },
  { row: 508, productId: "1297048633458", productHandle: "maria-white" },
  { row: 509, productId: "1570064171094", productHandle: "charizma-ps-15" },
  { row: 510, productId: "3534574321750", productHandle: "zainab-chottani-10a" },
  { row: 511, productId: "195633479705", productHandle: "bareeze-995-white" },
  { row: 254, productId: "3449504170070", productHandle: "anaya-peach" },
];

async function main() {
  const [storeSlug] = process.argv.slice(2);
  const store = await prisma.store.findUnique({ where: { slug: storeSlug } });
  if (!store) {
    console.error(`No store found with slug "${storeSlug}".`);
    process.exit(1);
  }

  const totalProducts = await prisma.product.count({ where: { storeId: store.id } });

  const results = [];
  for (const item of PREVIOUSLY_UNMATCHED) {
    const byId = await prisma.product.findFirst({
      where: { storeId: store.id, shopifyProductId: toProductGid(item.productId) },
      select: { id: true, name: true },
    });
    const byHandle = await prisma.product.findFirst({
      where: { storeId: store.id, handle: item.productHandle },
      select: { id: true, name: true },
    });
    results.push({ ...item, nowMatchesById: Boolean(byId), nowMatchesByHandle: Boolean(byHandle), matchedProduct: byId ?? byHandle });
  }

  console.log(JSON.stringify({ storeSlug, totalProductsNow: totalProducts, results }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
