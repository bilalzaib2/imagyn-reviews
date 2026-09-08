import prisma from "../db.server";

export interface ProductGroupMember {
  id: string;
  name: string;
  featuredImage: string | null;
}

export interface ProductGroupRecord {
  id: string;
  name: string;
  products: ProductGroupMember[];
}

const MEMBER_SELECT = { id: true, name: true, featuredImage: true } as const;

function mapGroup(group: { id: string; name: string; products: ProductGroupMember[] }): ProductGroupRecord {
  return { id: group.id, name: group.name, products: group.products };
}

export interface UngroupedProduct {
  id: string;
  name: string;
}

// Feeds the "Add product" picker on each group — only products with no group yet, since a
// product can only belong to one group at a time (adding it to a second would silently move it,
// which the UI instead does explicitly via setProductGroup after first removing it).
export async function listUngroupedProducts(storeId: string): Promise<UngroupedProduct[]> {
  return prisma.product.findMany({
    where: { storeId, productGroupId: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function listProductGroups(storeId: string): Promise<ProductGroupRecord[]> {
  const groups = await prisma.productGroup.findMany({
    where: { storeId },
    include: { products: { select: MEMBER_SELECT, orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });

  return groups.map(mapGroup);
}

export async function createProductGroup(storeId: string, name: string): Promise<ProductGroupRecord> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Give this group a name.");
  }

  const group = await prisma.productGroup.create({
    data: { storeId, name: trimmed },
    include: { products: { select: MEMBER_SELECT } },
  });

  return mapGroup(group);
}

export async function renameProductGroup(storeId: string, groupId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Give this group a name.");
  }

  const result = await prisma.productGroup.updateMany({ where: { id: groupId, storeId }, data: { name: trimmed } });
  if (result.count === 0) {
    throw new Error("Group not found.");
  }
}

// The ProductGroup_productGroupId_fkey's onDelete: SetNull means every member product is
// automatically ungrouped by the database itself the moment this row is deleted — no manual
// "unassign every member first" step needed here.
export async function deleteProductGroup(storeId: string, groupId: string): Promise<void> {
  const result = await prisma.productGroup.deleteMany({ where: { id: groupId, storeId } });
  if (result.count === 0) {
    throw new Error("Group not found.");
  }
}

// storeId-scoped ownership check on BOTH the product and the group before assigning — mirrors
// review.server.ts's own product-ownership pattern (never trust a client-supplied id pair
// without verifying both belong to the caller's store). groupId: null removes the product from
// whatever group it's currently in.
export async function setProductGroup(storeId: string, productId: string, groupId: string | null): Promise<void> {
  const product = await prisma.product.findFirst({ where: { id: productId, storeId }, select: { id: true } });
  if (!product) {
    throw new Error("Product not found.");
  }

  if (groupId) {
    const group = await prisma.productGroup.findFirst({ where: { id: groupId, storeId }, select: { id: true } });
    if (!group) {
      throw new Error("Group not found.");
    }
  }

  await prisma.product.update({ where: { id: productId }, data: { productGroupId: groupId } });
}

// The real integration point for storefront review aggregation — see review.server.ts's
// getProductReviews/getPublicReviewSummary, both widened to accept a productId array for
// exactly this. Returns the product's own id alone when it isn't grouped (the overwhelmingly
// common case, and the only case before this feature existed — every existing single-product
// caller keeps working unchanged), or every member of its group, itself included, when it is —
// so a shopper viewing any product in a group sees reviews left on all of them, not just the
// one page they happen to be on.
export async function getGroupedProductIds(productId: string): Promise<string[]> {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { productGroupId: true } });

  if (!product?.productGroupId) {
    return [productId];
  }

  const members = await prisma.product.findMany({
    where: { productGroupId: product.productGroupId },
    select: { id: true },
  });

  return members.map((member) => member.id);
}
