// The single place review imports resolve "which product is this row about" — used by every
// importer (csv.server.ts today, judgeme.server.ts and future providers). Tries progressively
// weaker signals, in the order a merchant would trust them, and never throws: an unmatched row
// is a normal outcome the caller reports, not an exception.
//
// Root cause this exists to fix: the previous matcher (reviewImportExport.server.ts's old
// resolveProductId) only ever compared a single loosely-typed "product" string against
// Product.handle or Product.name with an exact match — it never looked at
// Product.shopifyProductId (which the DB already stores, in GID form) at all. A Judge.me
// export's `product_id` column contains Shopify's bare numeric id, which never matched
// anything, so every row fell through to "Product not found" regardless of how clean the
// export was.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { Product } from "@prisma/client";
import { getProducts, toProductGid } from "../product.server";

export type ProductMatchTier =
  | "shopify_product_id"
  | "variant_id"
  | "handle"
  | "url"
  | "slug"
  | "sku"
  | "exact_title"
  | "normalized_title"
  | "fuzzy";

export interface ProductMatchInput {
  // Raw values straight off the export — bare numeric ids or GIDs, either is fine.
  productId?: string;
  variantId?: string;
  handle?: string;
  url?: string;
  slug?: string;
  sku?: string;
  title?: string;
}

export interface ProductMatchResult {
  productId: string | null;
  tier: ProductMatchTier | null;
}

function toVariantGid(variantId: string): string {
  const trimmed = variantId.trim();
  return trimmed.startsWith("gid://") ? trimmed : `gid://shopify/ProductVariant/${trimmed}`;
}

// Most review platforms (Judge.me included) export a full storefront URL —
// https://shop.myshopify.com/products/some-handle?variant=123 — rather than a bare handle.
function extractHandleFromUrl(url: string): string | null {
  const match = url.match(/\/products\/([a-z0-9][a-z0-9-]*)/i);
  return match ? match[1].toLowerCase() : null;
}

// Matches combining diacritical marks (U+0300-U+036F) left behind by String.normalize("NFKD")
// — verified via char-code inspection, since the range endpoints below are visually
// indistinguishable from other combining marks in source.
const DIACRITIC_MARKS_PATTERN = /[̀-ͯ]/g;

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(DIACRITIC_MARKS_PATTERN, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Token-overlap (Dice coefficient), not edit distance — at review-export title lengths,
// mismatches are almost always punctuation, a trailing variant suffix ("- Large / Blue"), or
// word order, which overlap tolerates far better than a character-level distance would.
function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const tokensB = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }
  return (2 * shared) / (tokensA.size + tokensB.size);
}

// Conservative on purpose — fuzzy is the last resort in the priority chain, only reached once
// every exact signal (id, handle, url, slug, sku, title) has failed. A false match here
// silently attaches a review to the wrong product, which is worse than leaving it unmatched
// and reported.
const FUZZY_MATCH_THRESHOLD = 0.75;

// Loaded once per import run (not once per row) — a store's product catalog is read once via
// getProducts, then every row matches against in-memory maps. The two Admin API tiers (variant
// id, SKU) are the only per-row network calls, and only run when every local tier has already
// failed, with their own per-run cache so a repeated id/SKU across rows costs one lookup.
export class ProductMatcher {
  private byGid = new Map<string, Product>();
  private byHandle = new Map<string, Product>();
  private bySlug = new Map<string, Product>();
  private byExactTitle = new Map<string, Product>();
  private byNormalizedTitle = new Map<string, Product>();
  private products: Product[];
  private variantGidCache = new Map<string, string | null>();
  private skuGidCache = new Map<string, string | null>();

  private constructor(products: Product[]) {
    this.products = products;

    for (const product of products) {
      if (product.shopifyProductId) {
        this.byGid.set(product.shopifyProductId, product);
      }
      if (product.handle) {
        this.byHandle.set(product.handle.trim().toLowerCase(), product);
      }
      if (product.slug) {
        this.bySlug.set(product.slug.trim().toLowerCase(), product);
      }
      this.byExactTitle.set(product.name.trim().toLowerCase(), product);
      this.byNormalizedTitle.set(normalizeTitle(product.name), product);
    }
  }

  static async forStore(storeId: string): Promise<ProductMatcher> {
    return new ProductMatcher(await getProducts(storeId));
  }

  async match(input: ProductMatchInput, admin: AdminApiContext | null): Promise<ProductMatchResult> {
    if (input.productId) {
      const product = this.byGid.get(toProductGid(input.productId));
      if (product) return { productId: product.id, tier: "shopify_product_id" };
    }

    if (input.variantId && admin) {
      const productGid = await this.resolveVariantToProductGid(input.variantId, admin);
      const product = productGid ? this.byGid.get(productGid) : undefined;
      if (product) return { productId: product.id, tier: "variant_id" };
    }

    if (input.handle) {
      const product = this.byHandle.get(input.handle.trim().toLowerCase());
      if (product) return { productId: product.id, tier: "handle" };
    }

    if (input.url) {
      const handle = extractHandleFromUrl(input.url);
      const product = handle ? this.byHandle.get(handle) : undefined;
      if (product) return { productId: product.id, tier: "url" };
    }

    if (input.slug) {
      const product = this.bySlug.get(input.slug.trim().toLowerCase());
      if (product) return { productId: product.id, tier: "slug" };
    }

    if (input.sku && admin) {
      const productGid = await this.resolveSkuToProductGid(input.sku, admin);
      const product = productGid ? this.byGid.get(productGid) : undefined;
      if (product) return { productId: product.id, tier: "sku" };
    }

    if (input.title) {
      const exact = this.byExactTitle.get(input.title.trim().toLowerCase());
      if (exact) return { productId: exact.id, tier: "exact_title" };

      const normalized = this.byNormalizedTitle.get(normalizeTitle(input.title));
      if (normalized) return { productId: normalized.id, tier: "normalized_title" };

      let best: { product: Product; score: number } | null = null;
      for (const product of this.products) {
        const score = titleSimilarity(input.title, product.name);
        if (score >= FUZZY_MATCH_THRESHOLD && (!best || score > best.score)) {
          best = { product, score };
        }
      }
      if (best) return { productId: best.product.id, tier: "fuzzy" };
    }

    return { productId: null, tier: null };
  }

  private async resolveVariantToProductGid(variantId: string, admin: AdminApiContext): Promise<string | null> {
    const gid = toVariantGid(variantId);
    if (this.variantGidCache.has(gid)) {
      return this.variantGidCache.get(gid) ?? null;
    }

    try {
      const response = await admin.graphql(
        `#graphql
        query ImportVariantProduct($id: ID!) {
          productVariant(id: $id) {
            product {
              id
            }
          }
        }`,
        { variables: { id: gid } },
      );
      const json = (await response.json()) as {
        data?: { productVariant?: { product?: { id?: string } | null } | null };
      };
      const productGid = json.data?.productVariant?.product?.id ?? null;
      this.variantGidCache.set(gid, productGid);
      return productGid;
    } catch {
      this.variantGidCache.set(gid, null);
      return null;
    }
  }

  private async resolveSkuToProductGid(sku: string, admin: AdminApiContext): Promise<string | null> {
    const key = sku.trim().toLowerCase();
    if (key === "") return null;
    if (this.skuGidCache.has(key)) {
      return this.skuGidCache.get(key) ?? null;
    }

    try {
      const response = await admin.graphql(
        `#graphql
        query ImportVariantBySku($query: String!) {
          productVariants(first: 1, query: $query) {
            nodes {
              product {
                id
              }
            }
          }
        }`,
        { variables: { query: `sku:${JSON.stringify(sku.trim())}` } },
      );
      const json = (await response.json()) as {
        data?: { productVariants?: { nodes?: Array<{ product?: { id?: string } | null }> } };
      };
      const productGid = json.data?.productVariants?.nodes?.[0]?.product?.id ?? null;
      this.skuGidCache.set(key, productGid);
      return productGid;
    } catch {
      this.skuGidCache.set(key, null);
      return null;
    }
  }
}
