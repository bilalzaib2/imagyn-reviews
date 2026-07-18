import { useState } from "react";
import { redirect, useFetcher, useLoaderData, useLocation, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Banner, Card } from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { LinkButton } from "../components/ui/LinkButton";
import { ReviewForm, type ReviewFormValues } from "../components/reviews/ReviewForm";
import { authenticate } from "../shopify.server";
import { getOrCreateStore } from "../services/store.server";
import { getProducts } from "../services/product.server";
import { createReview } from "../services/review.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.review-form.module.css";

type ActionData = {
  ok: boolean;
  error?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop);
  const products = await getProducts(store.id);

  return {
    products: products.map((product) => ({ id: product.id, name: product.name })),
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

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const values = parseValues(formData);

  if (!values.productId) {
    return { ok: false, error: "Select a product for this review." };
  }

  try {
    await createReview({
      productId: values.productId,
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
      error: error instanceof Error ? error.message : "Unable to create review.",
    };
  }

  return redirect("/app/reviews");
};

const emptyValues: ReviewFormValues = {
  productId: "",
  rating: 5,
  title: "",
  content: "",
  reviewerName: "",
  reviewerEmail: "",
  reviewerLocation: "",
  verifiedPurchase: false,
  featured: false,
};

export default function NewReviewPage() {
  const { products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const location = useLocation();
  const isSubmitting = fetcher.state !== "idle";

  const [values, setValues] = useState<ReviewFormValues>(emptyValues);

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

  const backHref = `/app/reviews${location.search}`;

  return (
    <Container as="main">
      <div className={`${shellStyles.page} ${styles.page}`}>
        <header className={`${shellStyles.header} ${styles.header}`}>
          <div className={shellStyles.headerContent}>
            <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
            <h1 className={`${shellStyles.title} ${styles.title}`}>New Review</h1>
            <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>
              Add a review directly to a product.
            </p>
          </div>
        </header>

        {fetcher.data && !fetcher.data.ok ? <Banner tone="critical">{fetcher.data.error}</Banner> : null}

        <Card>
          <ReviewForm
            mode="create"
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
            disabled={isSubmitting || !values.productId || !values.reviewerName.trim() || !values.content.trim()}
          >
            {isSubmitting ? "Saving..." : "Create Review"}
          </Button>
        </div>
      </div>
    </Container>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
