import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ReviewStatus } from "../services/review.shared";
import {
  createReview,
  getProductReviews,
  getPublicReviewSummary,
  getVisitorVotes,
  rankByHelpfulness,
} from "../services/review.server";
import {
  MAX_IMAGES_PER_REVIEW,
  getProductMediaGallery,
  uploadReviewImages,
  type ReviewImageFile,
} from "../services/reviewMedia.server";
import { getProductForStoreByShopifyId } from "../services/product.server";
import { getStoreBySlug } from "../services/store.server";
import { getStorefrontWidgetSettings } from "../services/widget.server";
import { getAiSummary } from "../services/aiSummary.server";

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

function serializeMedia(media: { id: string; type: string; url: string; thumbnailUrl: string | null; width: number | null; height: number | null }) {
  return {
    id: media.id,
    type: media.type,
    url: media.url,
    thumbnailUrl: media.thumbnailUrl,
    width: media.width,
    height: media.height,
  };
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
  // Client-generated anonymous id (or a real customer id later) — opaque to this endpoint,
  // only used to look up that visitor's own prior votes. Never trusted for anything else.
  const visitorId = url.searchParams.get("visitorId")?.trim() || "";
  const sort = url.searchParams.get("sort")?.trim() === "helpful" ? "helpful" : "recent";

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

  const [summary, result, widget, aiSummary, gallery] = await Promise.all([
    getPublicReviewSummary(product.id),
    getProductReviews(product.id, { status: ReviewStatus.APPROVED, limit: 50 }),
    getStorefrontWidgetSettings(store.id, product.id),
    // Pure cache read — never triggers generation, so this can never slow down or block a
    // storefront page view. Returns null until a merchant has generated one at least once.
    getAiSummary(product.id),
    // The aggregated, product-level Media Gallery — every customer photo across this
    // product's approved reviews, independent of which review page/sort is showing.
    getProductMediaGallery(product.id),
  ]);

  const orderedReviews = sort === "helpful" ? rankByHelpfulness(result.reviews) : result.reviews;
  const myVotes = await getVisitorVotes(
    orderedReviews.map((review) => review.id),
    visitorId,
  );

  return json({
    ok: true,
    summary,
    widget,
    aiSummary: aiSummary
      ? { summary: aiSummary.summary, recommendation: aiSummary.recommendation }
      : null,
    gallery: gallery.map((item) => ({
      id: item.id,
      reviewId: item.reviewId,
      url: item.url,
      thumbnailUrl: item.thumbnailUrl,
      width: item.width,
      height: item.height,
    })),
    reviews: orderedReviews.map((review) => ({
      id: review.id,
      reviewerName: review.reviewerName,
      rating: review.rating,
      title: review.title,
      content: review.content,
      createdAt: review.createdAt,
      helpfulCount: review.helpfulCount,
      notHelpfulCount: review.notHelpfulCount,
      myVote: myVotes[review.id] ?? null,
      media: review.media.map(serializeMedia),
    })),
  });
};

async function readImageFiles(formData: FormData): Promise<ReviewImageFile[]> {
  const files: ReviewImageFile[] = [];

  for (const entry of formData.getAll("images")) {
    if (!(entry instanceof File) || entry.size === 0) {
      continue;
    }

    files.push({
      filename: entry.name || "photo",
      mimeType: entry.type || "application/octet-stream",
      buffer: Buffer.from(await entry.arrayBuffer()),
    });
  }

  return files.slice(0, MAX_IMAGES_PER_REVIEW);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (isPreflight(request)) {
    return preflightResponse();
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  // Throws a 400 Response when the request wasn't genuinely forwarded by Shopify's App
  // Proxy (missing/invalid signature) — this is what actually rejects non-Shopify traffic.
  // `admin` is only present when a session exists for the shop (always true for an
  // installed, embedded app), and is what image uploads use to reach Shopify's Files API.
  const { admin } = await authenticate.public.appProxy(request);

  // `shop` comes from the verified, signed query param Shopify's proxy appends — not from
  // the request body, since the body itself isn't covered by the signature.
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.trim() || "";

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid form submission." }, { status: 400 });
  }

  const field = (name: string) => String(formData.get(name) ?? "").trim();

  const productId = field("productId");
  const rating = Number(formData.get("rating"));
  const customerName = field("customerName");
  const customerEmail = field("customerEmail");
  const title = field("title");
  const content = field("content");
  const imageFiles = await readImageFiles(formData);

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

    let media: { uploaded: number; failed: Array<{ filename: string; error: string }> } | null = null;

    if (imageFiles.length > 0) {
      if (admin) {
        const result = await uploadReviewImages(review.id, imageFiles, admin);
        media = { uploaded: result.uploaded.length, failed: result.failed };
      } else {
        media = {
          uploaded: 0,
          failed: imageFiles.map((file) => ({ filename: file.filename, error: "Uploads are temporarily unavailable." })),
        };
      }
    }

    return json(
      {
        ok: true,
        review: {
          id: review.id,
          status: review.status,
          createdAt: review.createdAt,
        },
        media,
      },
      { status: 201 },
    );
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Unable to submit review." }, { status: 400 });
  }
};
