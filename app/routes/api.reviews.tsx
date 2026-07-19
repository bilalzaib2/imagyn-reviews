import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { ReviewStatus } from "../services/review.shared";
import { createReview, getProductReviews, getPublicReviewSummary } from "../services/review.server";
import { getProductForStore } from "../services/product.server";
import { getStoreBySlug } from "../services/store.server";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...(init?.headers ?? {}),
    },
  });
}

function storeSlugFromShop(shop: string) {
  return shop.replace(".myshopify.com", "");
}

// Public, unauthenticated read for the storefront widget: shop + productId identify the
// tenant/product, only APPROVED reviews are ever returned, and only display-safe fields
// are included (no reviewerEmail/reviewerLocation).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.trim() || "";
  const productId = url.searchParams.get("productId")?.trim() || "";

  if (!shop || !productId) {
    return json({ ok: false, error: "shop and productId are required." }, { status: 400 });
  }

  const store = await getStoreBySlug(storeSlugFromShop(shop));

  if (!store) {
    return json({ ok: false, error: "Shop not found." }, { status: 404 });
  }

  const product = await getProductForStore(productId, store.id);

  if (!product) {
    return json({ ok: false, error: "Product not found for this shop." }, { status: 404 });
  }

  const [summary, result] = await Promise.all([
    getPublicReviewSummary(product.id),
    getProductReviews(product.id, { status: ReviewStatus.APPROVED, limit: 50 }),
  ]);

  return json({
    ok: true,
    summary,
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
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const shop = typeof payload.shop === "string" ? payload.shop.trim() : "";
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

  const product = await getProductForStore(productId, store.id);

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
