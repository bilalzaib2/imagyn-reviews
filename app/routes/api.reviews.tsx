import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ReviewStatus } from "../services/review.shared";
import { createReview, getProductReviews, getPublicReviewSummary } from "../services/review.server";
import { getProductForStoreByShopifyId } from "../services/product.server";
import { getStoreBySlug } from "../services/store.server";
import { getStorefrontWidgetSettings } from "../services/widget.server";

// Shared with api.reviews.batch.tsx so the two public review endpoints respond identically.
export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...(init?.headers ?? {}),
    },
  });
}

export function storeSlugFromShop(shop: string) {
  return shop.replace(".myshopify.com", "");
}

// A cross-origin POST with a JSON body is not a CORS "simple request," so the browser
// sends an OPTIONS preflight first. React Router dispatches OPTIONS to the loader (it's
// not a mutation method), so both loader and action short-circuit it the same way.
export function isPreflight(request: Request) {
  return request.method === "OPTIONS";
}

export function preflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// Public, unauthenticated read for the storefront widget: shop + productId identify the
// tenant/product, only APPROVED reviews are ever returned, and only display-safe fields
// are included (no reviewerEmail/reviewerLocation).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (isPreflight(request)) {
    return preflightResponse();
  }

  // Throws a 400 Response when the request wasn't genuinely forwarded by Shopify's App
  // Proxy (missing/invalid signature) — this is what actually rejects non-Shopify traffic.
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  // `shop` is one of the query params covered by the signature just verified above, so
  // it's now a trusted value, not client-supplied.
  const shop = url.searchParams.get("shop")?.trim() || "";
  const productId = url.searchParams.get("productId")?.trim() || "";

  if (!shop || !productId) {
    return json({ ok: false, error: "shop and productId are required." }, { status: 400 });
  }

  const store = await getStoreBySlug(storeSlugFromShop(shop));

  if (!store) {
    return json({ ok: false, error: "Shop not found." }, { status: 404 });
  }

  const product = await getProductForStoreByShopifyId(productId, store.id);

  if (!product) {
    return json({ ok: false, error: "Product not found for this shop." }, { status: 404 });
  }

  const [summary, result, widget] = await Promise.all([
    getPublicReviewSummary(product.id),
    getProductReviews(product.id, { status: ReviewStatus.APPROVED, limit: 50 }),
    getStorefrontWidgetSettings(store.id, product.id),
  ]);

  return json({
    ok: true,
    summary,
    widget,
    reviews: result.reviews.map((review) => ({
      id: review.id,
      reviewerName: review.reviewerName,
      rating: review.rating,
      title: review.title,
      content: review.content,
      createdAt: review.createdAt,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (isPreflight(request)) {
    return preflightResponse();
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  // Throws a 400 Response when the request wasn't genuinely forwarded by Shopify's App
  // Proxy (missing/invalid signature) — this is what actually rejects non-Shopify traffic.
  await authenticate.public.appProxy(request);

  // `shop` comes from the verified, signed query param Shopify's proxy appends — not from
  // the request body, since the body itself isn't covered by the signature.
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.trim() || "";

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const productId = typeof payload.productId === "string" ? payload.productId.trim() : "";
  const rating = Number(payload.rating);
  const customerName = typeof payload.customerName === "string" ? payload.customerName.trim() : "";
  const customerEmail = typeof payload.customerEmail === "string" ? payload.customerEmail.trim() : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const content = typeof payload.content === "string" ? payload.content.trim() : "";

  const errors: string[] = [];
  if (!shop) errors.push("Shop is required.");
  if (!productId) errors.push("Product ID is required.");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.push("Rating must be a whole number between 1 and 5.");
  }
  if (!customerName) errors.push("Customer name is required.");
  if (!content) errors.push("Review content is required.");

  if (errors.length > 0) {
    return json({ ok: false, error: errors.join(" ") }, { status: 400 });
  }

  const store = await getStoreBySlug(storeSlugFromShop(shop));

  if (!store) {
    return json({ ok: false, error: "Shop not found." }, { status: 404 });
  }

  const product = await getProductForStoreByShopifyId(productId, store.id);

  if (!product) {
    return json({ ok: false, error: "Product not found for this shop." }, { status: 404 });
  }

  try {
    const review = await createReview({
      productId: product.id,
      rating,
      title: title || null,
      content,
      reviewerName: customerName,
      reviewerEmail: customerEmail || null,
    });

    return json(
      {
        ok: true,
        review: {
          id: review.id,
          status: review.status,
          createdAt: review.createdAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Unable to submit review." }, { status: 400 });
  }
};
