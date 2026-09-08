// Exercises productGroup.server.ts's real create/rename/delete/assignment logic and its
// getGroupedProductIds integration point against a fake in-memory Prisma client — no real
// database.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeGroup {
  id: string;
  storeId: string;
  name: string;
}

interface FakeProduct {
  id: string;
  storeId: string;
  name: string;
  featuredImage: string | null;
  productGroupId: string | null;
}

let groups: FakeGroup[];
let products: FakeProduct[];
let nextGroupId: number;

vi.mock("../db.server", () => ({
  default: {
    productGroup: {
      findMany: vi.fn(async ({ where }: { where: { storeId: string } }) =>
        groups
          .filter((g) => g.storeId === where.storeId)
          .map((g) => ({ ...g, products: products.filter((p) => p.productGroupId === g.id) })),
      ),
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) => {
        const group = groups.find((g) => g.id === where.id && g.storeId === where.storeId);
        return group ?? null;
      }),
      create: vi.fn(async ({ data }: { data: { storeId: string; name: string } }) => {
        const group: FakeGroup = { id: `group_${nextGroupId++}`, storeId: data.storeId, name: data.name };
        groups.push(group);
        return { ...group, products: [] };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; storeId: string }; data: { name: string } }) => {
        const target = groups.find((g) => g.id === where.id && g.storeId === where.storeId);
        if (!target) return { count: 0 };
        target.name = data.name;
        return { count: 1 };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) => {
        const before = groups.length;
        groups = groups.filter((g) => !(g.id === where.id && g.storeId === where.storeId));
        const deletedCount = before - groups.length;
        // Real onDelete: SetNull behavior, simulated — the migration's own FK constraint does
        // this at the database level in production; the fake must mirror it for the test to
        // mean anything.
        if (deletedCount > 0) {
          products.forEach((p) => {
            if (p.productGroupId === where.id) p.productGroupId = null;
          });
        }
        return { count: deletedCount };
      }),
    },
    product: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) => {
        const product = products.find((p) => p.id === where.id && p.storeId === where.storeId);
        return product ? { id: product.id } : null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const product = products.find((p) => p.id === where.id);
        return product ? { productGroupId: product.productGroupId } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { productGroupId: string | null; storeId?: string } }) =>
        products
          .filter((p) => p.productGroupId === where.productGroupId && (where.storeId === undefined || p.storeId === where.storeId))
          .map((p) => ({ id: p.id, name: p.name })),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { productGroupId: string | null } }) => {
        const product = products.find((p) => p.id === where.id);
        if (!product) throw new Error("Product not found");
        product.productGroupId = data.productGroupId;
        return product;
      }),
    },
  },
}));

const {
  createProductGroup,
  deleteProductGroup,
  getGroupedProductIds,
  listProductGroups,
  listUngroupedProducts,
  renameProductGroup,
  setProductGroup,
} = await import("./productGroup.server");

function seedProduct(overrides: Partial<FakeProduct> & { id: string; storeId: string }): FakeProduct {
  const product: FakeProduct = { name: "Product", featuredImage: null, productGroupId: null, ...overrides };
  products.push(product);
  return product;
}

beforeEach(() => {
  groups = [];
  products = [];
  nextGroupId = 1;
});

describe("createProductGroup", () => {
  it("creates a real group with the given name", async () => {
    const group = await createProductGroup("store_1", "Classic Tee");
    expect(group.name).toBe("Classic Tee");
    expect(group.products).toEqual([]);
  });

  it("rejects a blank name", async () => {
    await expect(createProductGroup("store_1", "   ")).rejects.toThrow("Give this group a name.");
  });
});

describe("renameProductGroup", () => {
  it("renames a real group belonging to the caller's store", async () => {
    const group = await createProductGroup("store_1", "Old Name");
    await renameProductGroup("store_1", group.id, "New Name");
    const groups2 = await listProductGroups("store_1");
    expect(groups2[0].name).toBe("New Name");
  });

  it("never renames another store's group", async () => {
    const group = await createProductGroup("store_2", "Their Group");
    await expect(renameProductGroup("store_1", group.id, "Hijacked")).rejects.toThrow("Group not found.");
  });
});

describe("setProductGroup / getGroupedProductIds", () => {
  it("returns just the product's own id when it isn't grouped", async () => {
    seedProduct({ id: "p1", storeId: "store_1" });
    expect(await getGroupedProductIds("p1")).toEqual(["p1"]);
  });

  it("assigns a product to a group and expands getGroupedProductIds to every member", async () => {
    seedProduct({ id: "p1", storeId: "store_1" });
    seedProduct({ id: "p2", storeId: "store_1" });
    const group = await createProductGroup("store_1", "Classic Tee");

    await setProductGroup("store_1", "p1", group.id);
    await setProductGroup("store_1", "p2", group.id);

    const ids = await getGroupedProductIds("p1");
    expect(ids.sort()).toEqual(["p1", "p2"]);
  });

  it("never assigns a product to another store's group", async () => {
    seedProduct({ id: "p1", storeId: "store_1" });
    const group = await createProductGroup("store_2", "Their Group");
    await expect(setProductGroup("store_1", "p1", group.id)).rejects.toThrow("Group not found.");
  });

  it("never assigns another store's product even with a valid group id", async () => {
    seedProduct({ id: "p1", storeId: "store_2" });
    const group = await createProductGroup("store_1", "My Group");
    await expect(setProductGroup("store_1", "p1", group.id)).rejects.toThrow("Product not found.");
  });

  it("removes a product from its group when passed null", async () => {
    seedProduct({ id: "p1", storeId: "store_1" });
    const group = await createProductGroup("store_1", "Classic Tee");
    await setProductGroup("store_1", "p1", group.id);

    await setProductGroup("store_1", "p1", null);
    expect(await getGroupedProductIds("p1")).toEqual(["p1"]);
  });
});

describe("deleteProductGroup", () => {
  it("ungroups every member product when the group is deleted, without deleting the products", async () => {
    seedProduct({ id: "p1", storeId: "store_1" });
    const group = await createProductGroup("store_1", "Classic Tee");
    await setProductGroup("store_1", "p1", group.id);

    await deleteProductGroup("store_1", group.id);

    expect(await getGroupedProductIds("p1")).toEqual(["p1"]);
    expect(products.find((p) => p.id === "p1")).toBeDefined();
  });

  it("never deletes another store's group", async () => {
    const group = await createProductGroup("store_2", "Their Group");
    await expect(deleteProductGroup("store_1", group.id)).rejects.toThrow("Group not found.");
  });
});

describe("listUngroupedProducts", () => {
  it("only lists products with no group yet, scoped to the caller's store", async () => {
    seedProduct({ id: "p1", storeId: "store_1", name: "Ungrouped" });
    seedProduct({ id: "p2", storeId: "store_1", name: "Grouped", productGroupId: "group_x" });
    seedProduct({ id: "p3", storeId: "store_2", name: "Other store" });

    const result = await listUngroupedProducts("store_1");
    expect(result).toEqual([{ id: "p1", name: "Ungrouped" }]);
  });
});
