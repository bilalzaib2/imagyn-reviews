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
  // Null whenever ambiguous is true — an uncertain match is never auto-attached, only
  // reported (see reviewImportExport.server.ts's importRow). Also null for a genuine
  // no-match.
  productId: string | null;
  tier: ProductMatchTier | null;
  // True when more than one product in the catalog is a plausible candidate for this row and
  // no single one is clearly the best — e.g. two products share the exact same title, or two
  // fuzzy-title candidates score within FUZZY_AMBIGUITY_MARGIN of each other. Never silently
  // resolved by picking one; the caller must leave the row unmatched and ask the merchant.
  ambiguous: boolean;
  // Present only when ambiguous — the plausible candidates, for diagnostics ("could be X or
  // Y").
  candidateProductIds?: string[];
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

// Two fuzzy candidates within this margin of each other are "too close to call" — reported as
// ambiguous rather than silently picking whichever happened to score marginally higher. A
// single-digit-percent margin, not a large one: this only needs to catch genuine near-ties
// (e.g. 0.80 vs 0.82 for two very similarly-named products), not turn every fuzzy match with
// any second candidate at all into an ambiguous one.
const FUZZY_AMBIGUITY_MARGIN = 0.05;

// Loaded once per import run (not once per row) — a store's product catalog is read once via
// getProducts, then every row matches against in-memory maps. The two Admin API tiers (variant
// id, SKU) are the only per-row network calls, and only run when every local tier has already
// failed, with their own per-run cache so a repeated id/SKU across rows costs one lookup.
export class ProductMatcher {
  private byGid = new Map<string, Product>();
  private byHandle = new Map<string, Product>();
  private bySlug = new Map<string, Product>();
  // Arrays, not a single Product — lets exact/normalized title lookups detect the rare but
  // real case of two products in the same catalog sharing an identical (or identically
  // normalized) title, e.g. the same product name reused across two collections. A Map keyed
  // to a single Product would silently let the last-inserted one shadow the other.
  private byExactTitle = new Map<string, Product[]>();
  private byNormalizedTitle = new Map<string, Product[]>();
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
      const exactKey = product.name.trim().toLowerCase();
      this.byExactTitle.set(exactKey, [...(this.byExactTitle.get(exactKey) ?? []), product]);
      const normalizedKey = normalizeTitle(product.name);
      this.byNormalizedTitle.set(normalizedKey, [...(this.byNormalizedTitle.get(normalizedKey) ?? []), product]);
    }
  }

  static async forStore(storeId: string): Promise<ProductMatcher> {
    return new ProductMatcher(await getProducts(storeId));
  }

  async match(input: ProductMatchInput, admin: AdminApiContext | null): Promise<ProductMatchResult> {
    if (input.productId) {
      const product = this.byGid.get(toProductGid(input.productId));
      if (product) return { productId: product.id, tier: "shopify_product_id", ambiguous: false };
    }

    if (input.variantId && admin) {
      const productGid = await this.resolveVariantToProductGid(input.variantId, admin);
      const product = productGid ? this.byGid.get(productGid) : undefined;
      if (product) return { productId: product.id, tier: "variant_id", ambiguous: false };
    }

    if (input.handle) {
      const product = this.byHandle.get(input.handle.trim().toLowerCase());
      if (product) return { productId: product.id, tier: "handle", ambiguous: false };
    }

    if (input.url) {
      const handle = extractHandleFromUrl(input.url);
      const product = handle ? this.byHandle.get(handle) : undefined;
      if (product) return { productId: product.id, tier: "url", ambiguous: false };
    }

    if (input.slug) {
      const product = this.bySlug.get(input.slug.trim().toLowerCase());
      if (product) return { productId: product.id, tier: "slug", ambiguous: false };
    }

    if (input.sku && admin) {
      const productGid = await this.resolveSkuToProductGid(input.sku, admin);
      const product = productGid ? this.byGid.get(productGid) : undefined;
      if (product) return { productId: product.id, tier: "sku", ambiguous: false };
    }

    if (input.title) {
      const exact = this.byExactTitle.get(input.title.trim().toLowerCase());
      if (exact) {
        if (exact.length > 1) {
          return { productId: null, tier: "exact_title", ambiguous: true, candidateProductIds: exact.map((p) => p.id) };
        }
        return { productId: exact[0].id, tier: "exact_title", ambiguous: false };
      }

      const normalized = this.byNormalizedTitle.get(normalizeTitle(input.title));
      if (normalized) {
        if (normalized.length > 1) {
          return {
            productId: null,
            tier: "normalized_title",
            ambiguous: true,
            candidateProductIds: normalized.map((p) => p.id),
          };
        }
        return { productId: normalized[0].id, tier: "normalized_title", ambiguous: false };
      }

      // Every candidate at/above threshold, not just the single best — needed to detect a
      // near-tie, not just to pick a winner.
      const candidates: Array<{ product: Product; score: number }> = [];
      for (const product of this.products) {
        const score = titleSimilarity(input.title, product.name);
        if (score >= FUZZY_MATCH_THRESHOLD) {
          candidates.push({ product, score });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const [best, runnerUp] = candidates;
        if (runnerUp && best.score - runnerUp.score < FUZZY_AMBIGUITY_MARGIN) {
          return {
            productId: null,
            tier: "fuzzy",
            ambiguous: true,
            candidateProductIds: candidates
              .filter((c) => best.score - c.score < FUZZY_AMBIGUITY_MARGIN)
              .map((c) => c.product.id),
          };
        }
        return { productId: best.product.id, tier: "fuzzy", ambiguous: false };
      }
    }

    return { productId: null, tier: null, ambiguous: false };
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
