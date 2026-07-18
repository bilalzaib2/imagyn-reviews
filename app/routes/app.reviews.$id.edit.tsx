import { useState } from "react";
import { redirect, useFetcher, useLoaderData, useLocation, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as PolarisAppProvider, Banner, Card, EmptyState } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { Button } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { LinkButton } from "../components/ui/LinkButton";
import { ReviewForm, type ReviewFormValues } from "../components/reviews/ReviewForm";
import { authenticate } from "../shopify.server";
import { getOrCreateStore } from "../services/store.server";
import { getProducts } from "../services/product.server";
import { getReview, updateReview } from "../services/review.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.review-form.module.css";

type ActionData = {
  ok: boolean;
  error?: string;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop);
  const reviewId = params.id ?? "";

  const review = reviewId ? await getReview(reviewId) : null;
  const isOwnedByStore = Boolean(review && review.storeId === store.id);

  const products = await getProducts(store.id);

  return {
    review: isOwnedByStore ? review : null,
    products: products.map((product) => ({ id: product.id, name: product.name })),
    error: isOwnedByStore ? null : "Review not found.",
  };
};

const parseValues = (formData: FormData): ReviewFormValues => ({
  productId: String(formData.get("productId") || ""),
  rating: Number(formData.get("rating") || "0"),
  title: String(formData.get("title") || ""),
  content: String(formData.get("content") || ""),
  reviewerName: String(formData.get("reviewerName") || ""),
  reviewerEmail: String(formData.get("reviewerEmail") || ""),
  reviewerLocation: String(formData.get("reviewerLocation") || ""),
  verifiedPurchase: formData.get("verifiedPurchase") === "true",
  featured: formData.get("featured") === "true",
});

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const reviewId = params.id ?? "";

  if (!reviewId) {
    return { ok: false, error: "Missing review id." };
  }

  const formData = await request.formData();
  const values = parseValues(formData);

  try {
    await updateReview(reviewId, {
      rating: values.rating,
      title: values.title || null,
      content: values.content,
      reviewerName: values.reviewerName,
      reviewerEmail: values.reviewerEmail || null,
      reviewerLocation: values.reviewerLocation || null,
      verifiedPurchase: values.verifiedPurchase,
      featured: values.featured,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to update review.",
    };
  }

  return redirect("/app/reviews");
};

export default function EditReviewPage() {
  const { review, products, error } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const location = useLocation();
  const isSubmitting = fetcher.state !== "idle";
  const backHref = `/app/reviews${location.search}`;

  const [values, setValues] = useState<ReviewFormValues>(() => ({
    productId: review?.productId ?? "",
    rating: review?.rating ?? 5,
    title: review?.title ?? "",
    content: review?.content ?? "",
    reviewerName: review?.reviewerName ?? "",
    reviewerEmail: review?.reviewerEmail ?? "",
    reviewerLocation: review?.reviewerLocation ?? "",
    verifiedPurchase: review?.verifiedPurchase ?? false,
    featured: review?.featured ?? false,
  }));

  const handleChange = <K extends keyof ReviewFormValues>(key: K, value: ReviewFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    const formData = new FormData();
    formData.set("productId", values.productId);
    formData.set("rating", String(values.rating));
    formData.set("title", values.title);
    formData.set("content", values.content);
    formData.set("reviewerName", values.reviewerName);
    formData.set("reviewerEmail", values.reviewerEmail);
    formData.set("reviewerLocation", values.reviewerLocation);
    formData.set("verifiedPurchase", String(values.verifiedPurchase));
    formData.set("featured", String(values.featured));
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <PolarisAppProvider i18n={enTranslations}>
      <Container as="main">
        <div className={`${shellStyles.page} ${styles.page}`}>
          <header className={`${shellStyles.header} ${styles.header}`}>
            <div className={shellStyles.headerContent}>
              <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
              <h1 className={`${shellStyles.title} ${styles.title}`}>Edit Review</h1>
              <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>
                Update the review details below.
              </p>
            </div>
          </header>

          {fetcher.data && !fetcher.data.ok ? <Banner tone="critical">{fetcher.data.error}</Banner> : null}

          {!review ? (
            <Card>
              <Banner tone="critical">{error}</Banner>
              <EmptyState
                heading="This review isn't available"
                action={{ content: "Back to Reviews", url: backHref }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>It may have been deleted, or you may not have access to it.</p>
              </EmptyState>
            </Card>
          ) : (
            <>
              <Card>
                <ReviewForm
                  mode="edit"
                  products={products}
                  values={values}
                  onChange={handleChange}
                  disabled={isSubmitting}
                />
              </Card>

              <div className={styles.formActions}>
                <LinkButton to={backHref}>Cancel</LinkButton>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={isSubmitting || !values.reviewerName.trim() || !values.content.trim()}
                >
                  {isSubmitting ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Container>
    </PolarisAppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
