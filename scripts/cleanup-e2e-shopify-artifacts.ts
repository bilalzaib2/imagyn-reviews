/**
 * Deletes any leftover Imagyn end-to-end test artifacts from the development store.
 *
 * The e2e scripts clean up after themselves, but a failed assertion partway through an upload
 * can still strand a file. Test data nobody can account for is how a store stops being a
 * reliable place to test, so this is the janitor for that case.
 *
 * Only ever matches the IMAGYN-E2E- / imagyn-e2e- prefixes the e2e scripts generate, and only
 * ever runs against the development store.
 *
 * Run: node --import tsx --env-file=.env scripts/cleanup-e2e-shopify-artifacts.ts
 */
const STORE = "verveonline.myshopify.com";

const RECENT_FILES = `#graphql
  query RecentFiles {
    files(first: 100, sortKey: CREATED_AT, reverse: true) {
      nodes { id createdAt ... on MediaImage { image { url } } }
    }
  }
`;

const FILE_DELETE = `#graphql
  mutation FileDelete($ids: [ID!]!) {
    fileDelete(fileIds: $ids) { deletedFileIds userErrors { message } }
  }
`;

const DISCOUNTS = `#graphql
  query Discounts {
    codeDiscountNodes(first: 100, sortKey: CREATED_AT, reverse: true) {
      nodes { id codeDiscount { ... on DiscountCodeBasic { title codes(first: 1) { nodes { code } } } } }
    }
  }
`;

const DISCOUNT_DELETE = `#graphql
  mutation DiscountDelete($id: ID!) {
    discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { message } }
  }
`;

async function main() {
  const { unauthenticated } = await import("../app/shopify.server");
  const { admin } = await unauthenticated.admin(STORE);

  // --- files ---
  const filesResponse = await admin.graphql(RECENT_FILES);
  const filesJson = (await filesResponse.json()) as {
    data?: { files?: { nodes: { id: string; image?: { url?: string } | null }[] } };
  };
  const nodes = filesJson.data?.files?.nodes ?? [];
  const staleFiles = nodes.filter((n) => (n.image?.url ?? "").includes("imagyn-e2e-"));
  console.log(`files scanned: ${nodes.length}; matching "imagyn-e2e-": ${staleFiles.length}`);

  for (const file of staleFiles) {
    console.log("  ", file.id, (file.image?.url ?? "").split("/").pop()?.split("?")[0]);
  }

  if (staleFiles.length > 0) {
    const deleteResponse = await admin.graphql(FILE_DELETE, { variables: { ids: staleFiles.map((f) => f.id) } });
    const deleteJson = (await deleteResponse.json()) as {
      data?: { fileDelete?: { deletedFileIds: string[]; userErrors: { message: string }[] } };
    };
    console.log("  deleted:", deleteJson.data?.fileDelete?.deletedFileIds?.length ?? 0, "errors:", JSON.stringify(deleteJson.data?.fileDelete?.userErrors ?? []));
  }

  // --- discounts ---
  const discountResponse = await admin.graphql(DISCOUNTS);
  const discountJson = (await discountResponse.json()) as {
    data?: { codeDiscountNodes?: { nodes: { id: string; codeDiscount?: { title?: string; codes?: { nodes: { code: string }[] } } }[] } };
  };
  const discountNodes = discountJson.data?.codeDiscountNodes?.nodes ?? [];
  const staleDiscounts = discountNodes.filter((n) =>
    (n.codeDiscount?.codes?.nodes ?? []).some((c) => c.code.startsWith("IMAGYN-E2E-")),
  );
  console.log(`discounts scanned: ${discountNodes.length}; matching "IMAGYN-E2E-": ${staleDiscounts.length}`);

  for (const discount of staleDiscounts) {
    const response = await admin.graphql(DISCOUNT_DELETE, { variables: { id: discount.id } });
    const json = (await response.json()) as { data?: { discountCodeDelete?: { deletedCodeDiscountId?: string } } };
    console.log("  deleted:", json.data?.discountCodeDelete?.deletedCodeDiscountId ?? "FAILED", discount.codeDiscount?.codes?.nodes?.[0]?.code);
  }

  console.log("\nCleanup complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Keeps this file a module so its top-level consts do not collide with the other scripts.
export {};
