import { useState } from "react";
import { data, Form, isRouteErrorResponse, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { reviewRequestService } from "../services/review-request.server";
import { createReview } from "../services/review.server";
import { Button } from "../components/ui/Button";
import { StarRating } from "../components/reviews/StarRating";
import styles from "../styles/review-link.module.css";

type TokenErrorReason = "not_found" | "expired" | "used";

const ERROR_COPY: Record<TokenErrorReason, { title: string; message: string; icon: string }> = {
  not_found: {
    icon: "?",
    title: "Link not found",
    message: "This review link isn't valid. Double-check the URL, or ask for a new one.",
  },
  expired: {
    icon: "!",
    title: "This link has expired",
    message: "Review links stay open for a limited time. Reach out to the store for a new one.",
  },
  used: {
    icon: "✓",
    title: "Already submitted",
    message: "You've already reviewed this — thank you for sharing your feedback!",
  },
};

// Public, unauthenticated on purpose — no authenticate.admin() call. Reached only via the
// tokenized link in a review request email (see review-request.server.ts's buildReviewUrl),
// never linked to from the admin or storefront.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = params.token;

  if (!token) {
    throw data({ reason: "not_found" as TokenErrorReason }, { status: 404 });
  }

  const result = await reviewRequestService.validateRequestToken(token);

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 410;
    throw data({ reason: result.reason }, { status });
  }

  // Fire on every valid view, not just the first — markRequestOpened only moves
  // "sent" -> "opened" and is a no-op once the request has moved past that, so this is safe
  // to call unconditionally rather than tracking "have we already recorded this" ourselves.
  await reviewRequestService.markRequestOpened(token);

  return {
    productName: result.request.product?.name ?? "your recent purchase",
    storeName: result.request.store.name,
    customerName: result.request.name ?? "",
    customMessage: result.request.customMessage,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const token = params.token;

  if (!token) {
    return data({ ok: false as const, error: "This review link isn't valid." }, { status: 404 });
  }

  // Re-validated here, not just in the loader — time passes between page load and submit,
  // and the token could expire or (via another tab) already be used in between.
  const result = await reviewRequestService.validateRequestToken(token);

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 410;
    return data({ ok: false as const, error: ERROR_COPY[result.reason].message }, { status });
  }

  if (!result.request.product) {
    return data(
      { ok: false as const, error: "This review link is no longer linked to a product." },
      { status: 410 },
    );
  }

  const formData = await request.formData();
  const rating = Number(formData.get("rating") || "0");
  const title = String(formData.get("title") || "").trim();
  const content = String(formData.get("content") || "").trim();
  const reviewerName = String(formData.get("reviewerName") || "").trim();

  try {
    await createReview({
      productId: result.request.product.id,
      rating,
      title: title || null,
      content,
      reviewerName,
      reviewerEmail: result.request.email,
      // Submitted through a merchant-issued request tied to a specific customer/order —
      // a real, identified purchase, so this is a correct verified-purchase signal, not
      // a default we're fabricating.
      verifiedPurchase: true,
    });
  } catch (error) {
    return data(
      { ok: false as const, error: error instanceof Error ? error.message : "Unable to submit review." },
      { status: 400 },
    );
  }

  // Token is only consumed after the review is successfully created — a failed submission
  // (validation error, DB error) leaves the link usable for a retry.
  await reviewRequestService.consumeRequestToken(result.request.id);

  return { ok: true as const };
};

export default function ReviewLinkPage() {
  const { productName, storeName, customerName, customMessage } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [rating, setRating] = useState(5);

  if (actionData?.ok) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.status}>
            <div className={styles.statusIcon} aria-hidden="true">
              ✓
            </div>
            <h1 className={styles.title}>Thank you</h1>
            <p className={styles.message}>Your review of {productName} has been submitted.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>{storeName}</p>
        <h1 className={styles.title}>How was your {productName}?</h1>
        <p className={styles.message}>
          {customMessage || "Your feedback helps other shoppers decide with confidence — it only takes a minute."}
        </p>

        {actionData && !actionData.ok ? <div className={styles.error}>{actionData.error}</div> : null}

        <Form method="post">
          <div className={styles.field}>
            <span className={styles.label}>Rating</span>
            <StarRating value={rating} onChange={setRating} size={28} />
            <input type="hidden" name="rating" value={rating} />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="title">
              Headline <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>(optional)</span>
            </label>
            <input id="title" name="title" type="text" className={styles.input} maxLength={120} />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="content">
              Your review
            </label>
            <textarea id="content" name="content" className={styles.textarea} required />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="reviewerName">
              Your name
            </label>
            <input
              id="reviewerName"
              name="reviewerName"
              type="text"
              className={styles.input}
              defaultValue={customerName}
              required
            />
          </div>

          <div className={styles.actions}>
            <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit review"}
            </Button>
          </div>
        </Form>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    const reason: TokenErrorReason =
      error.data && typeof error.data === "object" && "reason" in error.data
        ? (error.data.reason as TokenErrorReason)
        : "not_found";
    const copy = ERROR_COPY[reason] ?? ERROR_COPY.not_found;

    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.status}>
            <div className={styles.statusIcon} aria-hidden="true">
              {copy.icon}
            </div>
            <h1 className={styles.title}>{copy.title}</h1>
            <p className={styles.message}>{copy.message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.status}>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.message}>Please try again in a moment.</p>
        </div>
      </div>
    </div>
  );
}
