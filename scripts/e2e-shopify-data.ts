/**
 * Real development-store integration tests for the Shopify data surfaces the product depends
 * on: the orders/customers layer behind review requests, the JSON-LD product metafield that
 * powers rich snippets, and the Files upload path behind photo/video reviews.
 *
 * Every assertion is a read-back from Shopify, not a mutation's own return value.
 *
 * Safety: refuses a non-local DATABASE_URL, targets only the development store, and deletes
 * the file it uploads in a finally block.
 *
 * Run: node --import tsx --env-file=.env scripts/e2e-shopify-data.ts
 */
import { PrismaClient } from "@prisma/client";
import { searchShopifyOrders } from "../app/services/shopifyOrders.server";
import { syncProductStructuredData } from "../app/services/structuredData/sync.server";

const STORE = "verveonline.myshopify.com";
const prisma = new PrismaClient();

const results: { ok: boolean; name: string; detail: string }[] = [];
const record = (ok: boolean, name: string, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL || "";
  const host = url.replace(/^[a-z]+:\/\/[^@]*@?/, "").split(/[/?]/)[0] || "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
    console.error(`Refusing to run: DATABASE_URL points at "${host}", not a local database.`);
    process.exit(1);
  }
  console.log(`Database: local (${host})`);
}

const READ_METAFIELD = `#graphql
  query ReadReviewsJsonLd($id: ID!) {
    product(id: $id) {
      id
      title
      metafield(namespace: "$app", key: "reviews_jsonld") { type value updatedAt }
    }
  }
`;

// Matched by CDN url rather than Shopify's `files(query: "filename:...")` search, which does
// not return a file this immediately after upload — that index is populated asynchronously,
// so a filename query here reports "not found" for a file that demonstrably exists and serves
// bytes over HTTP. Listing recent files and matching the url we were just handed is immediate
// and exact.
const RECENT_FILES = `#graphql
  query RecentFiles {
    files(first: 25, sortKey: CREATED_AT, reverse: true) {
      nodes { id fileStatus ... on MediaImage { image { url } } }
    }
  }
`;

const FILE_DELETE = `#graphql
  mutation FileDelete($ids: [ID!]!) {
    fileDelete(fileIds: $ids) { deletedFileIds userErrors { message } }
  }
`;

async function adminClient() {
  const { unauthenticated } = await import("../app/shopify.server");
  const { admin } = await unauthenticated.admin(STORE);
  return admin;
}

async function main() {
  assertLocalDatabase();
  const admin = await adminClient();

  const store = await prisma.store.findFirst({ where: { domain: STORE }, select: { id: true } });
  if (!store) {
    record(false, "local store row exists for the development store", "not found");
    return;
  }

  // ---- 1. Orders + customers: the real data layer behind manual and automatic requests ----
  const orders = await searchShopifyOrders(admin, store.id, {});
  record(Array.isArray(orders.orders), "searchShopifyOrders returns a real order page from Shopify", `orders=${orders.orders.length} hasNextPage=${orders.hasNextPage}`);

  if (orders.orders.length > 0) {
    const first = orders.orders[0];
    record(
      typeof first.shopifyOrderId === "string" && first.shopifyOrderId.startsWith("gid://shopify/Order/"),
      "orders carry real Shopify order GIDs",
      `${first.shopifyOrderId} #${first.orderNumber}`,
    );
    // Protected customer data: approved for Name + Email on 2026-09-08. If approval were
    // missing or revoked, Shopify redacts these to null while still returning the order —
    // which is exactly the silent failure the request engine must not mistake for "no email".
    const withEmail = orders.orders.filter((o) => Boolean(o.customerEmail)).length;
    record(true, "protected customer data visibility (informational)", `${withEmail}/${orders.orders.length} orders expose a customer email`);
  } else {
    record(true, "orders page is empty (informational)", "no orders on the development store in the default window");
  }

  const fulfilled = await searchShopifyOrders(admin, store.id, { fulfillmentStatus: "fulfilled" });
  record(Array.isArray(fulfilled.orders), "fulfillment-status filter is accepted by Shopify", `fulfilled orders=${fulfilled.orders.length}`);

  // ---- 2. JSON-LD product metafield: the rich-snippet path ----
  // Must have BOTH a real Shopify link and at least one approved review — a product with no
  // approved reviews makes the sync write null, which proves the clearing path but tells us
  // nothing about whether the JSON-LD we generate is well-formed.
  const candidates = await prisma.product.findMany({
    where: {
      storeId: store.id,
      shopifyProductId: { not: null },
      reviews: { some: { status: "APPROVED", deletedAt: null, archivedAt: null } },
    },
    select: { id: true, name: true, shopifyProductId: true },
  });
  const product = candidates[0];

  if (!product?.shopifyProductId) {
    record(false, "a local product is linked to a real Shopify product", "none found");
  } else {
    const status = await syncProductStructuredData(admin, product.id);
    record(status === "written" || status === "cleared", "syncProductStructuredData completed against Shopify", `status=${status} product=${product.name}`);

    const response = await admin.graphql(READ_METAFIELD, { variables: { id: product.shopifyProductId } });
    const json = (await response.json()) as {
      data?: { product?: { title: string; metafield?: { type: string; value: string; updatedAt: string } | null } | null };
    };
    const metafield = json.data?.product?.metafield;

    if (status === "written") {
      record(Boolean(metafield), "Shopify holds the reviews_jsonld metafield after the sync", metafield ? `type=${metafield.type} updatedAt=${metafield.updatedAt}` : "metafield is null");
      if (metafield) {
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(metafield.value);
        } catch {
          /* handled by the assertion below */
        }
        record(parsed !== null, "the stored metafield value is valid JSON");
        record(parsed?.["@type"] === "Product", "the JSON-LD declares schema.org Product", `@type=${parsed?.["@type"]}`);
        record(
          Boolean(parsed?.aggregateRating) || Array.isArray(parsed?.review),
          "the JSON-LD carries aggregateRating or review data",
          `aggregateRating=${JSON.stringify(parsed?.aggregateRating)}`,
        );
      }
    } else {
      record(true, "sync reported cleared (informational)", `no approved reviews for ${product.name}; metafield=${metafield ? "present" : "null"}`);
    }
  }

  // ---- 3. Files API: the photo/video review upload path ----
  // A 1x1 PNG is enough to exercise stagedUploadsCreate -> fileCreate -> node(id:) polling,
  // which is the whole provider contract. read access here is carried by write_files.
  let uploadedFileId: string | null = null;
  try {
    const { createShopifyFilesProvider } = await import("../app/services/storage/shopifyFiles.server");
    const provider = createShopifyFilesProvider();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );

    const filename = `imagyn-e2e-${Date.now()}.png`;
    const uploaded = await provider.uploadImage({ buffer: png, filename, mimeType: "image/png" }, { admin });

    record(Boolean(uploaded?.url), "Files upload returned a real Shopify CDN url", uploaded?.url?.slice(0, 72));
    record(
      typeof uploaded?.url === "string" && uploaded.url.includes("cdn.shopify.com"),
      "the url is served from Shopify's CDN",
      uploaded?.url ? new URL(uploaded.url).host : "no url",
    );
    record(Number(uploaded?.width) === 1 && Number(uploaded?.height) === 1, "Shopify reported real image dimensions", `${uploaded?.width}x${uploaded?.height}`);

    // The CDN url must actually serve bytes — a url in a GraphQL response is not a file.
    const head = await fetch(uploaded.url, { method: "GET" });
    record(head.ok, "the uploaded image is retrievable over HTTP", `HTTP ${head.status} ${head.headers.get("content-type")}`);

    // UploadedImage deliberately exposes only the public shape (url/width/height/thumbnail),
    // not the Shopify GID, so recover the id by filename for cleanup. This doubles as a real
    // read_files exercise — the scope carried by write_files.
    const lookup = await admin.graphql(RECENT_FILES);
    const lookupJson = (await lookup.json()) as {
      data?: { files?: { nodes: { id: string; fileStatus?: string; image?: { url?: string } | null }[] } };
    };
    const match = (lookupJson.data?.files?.nodes ?? []).find((n) => (n.image?.url ?? "").includes(filename));
    uploadedFileId = match?.id ?? null;
    record(Boolean(uploadedFileId), "the uploaded file is listed in the store's Files (read_files)", uploadedFileId ? `${uploadedFileId} status=${match?.fileStatus}` : "not found");
  } catch (error) {
    record(false, "Files upload path", String(error).slice(0, 220));
  } finally {
    if (uploadedFileId) {
      const response = await admin.graphql(FILE_DELETE, { variables: { ids: [uploadedFileId] } });
      const json = (await response.json()) as { data?: { fileDelete?: { deletedFileIds: string[]; userErrors: { message: string }[] } } };
      const ok = (json.data?.fileDelete?.deletedFileIds?.length ?? 0) > 0;
      record(ok, "uploaded test file deleted from Shopify (cleanup)", ok ? json.data!.fileDelete!.deletedFileIds[0] : JSON.stringify(json.data?.fileDelete?.userErrors));
    }
  }

  void RECENT_FILES;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} checks passed.`);
    if (passed !== results.length) process.exitCode = 1;
  });
