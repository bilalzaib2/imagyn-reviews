import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useRouteError,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as PolarisAppProvider, Button as PolarisButton, ButtonGroup, Frame, TextField, Toast } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { Button } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { reviewService } from "../services/review.server";
import { authenticate } from "../shopify.server";
import styles from "../styles/app.reviews.module.css";
import shellStyles from "../styles/app.shell.module.css";

type ReviewListItem = {
  id: string;
  title: string | null;
  body: string | null;
  authorName: string | null;
  authorEmail: string | null;
  merchantReply: string | null;
  repliedAt: Date | null;
  rating: number | null;
  status: string;
  verifiedPurchase: boolean;
  photoUrls: string | null;
  createdAt: Date;
  product: { id: string; name: string | null } | null;
};

type ActionData = {
  ok: boolean;
  intent?: string;
  error?: string;
  message?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || undefined;
  const status = url.searchParams.get("status")?.trim() || undefined;
  const ratingValue = url.searchParams.get("rating");
  const parsedRating = ratingValue ? Number(ratingValue) : undefined;
  const rating = Number.isFinite(parsedRating) ? parsedRating : undefined;
  const product = url.searchParams.get("product")?.trim() || undefined;
  const dateFrom = url.searchParams.get("dateFrom") || undefined;
  const dateTo = url.searchParams.get("dateTo") || undefined;
  const verifiedPurchase = url.searchParams.get("verifiedPurchase") === "true";
  const cursor = url.searchParams.get("cursor") || undefined;
  const prevCursor = url.searchParams.get("prevCursor") || undefined;

  try {
    const result = await reviewService.query({
      search,
      status,
      rating,
      product,
      dateFrom,
      dateTo,
      verifiedPurchase: verifiedPurchase || undefined,
      cursor,
      limit: 20,
    });

    return {
      reviews: result.reviews,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      totalCount: result.totalCount,
      error: null,
      search: search ?? "",
      status: status ?? "",
      rating: ratingValue ?? "",
      product: product ?? "",
      dateFrom: dateFrom ?? "",
      dateTo: dateTo ?? "",
      verifiedPurchase,
      prevCursor: prevCursor ?? "",
    };
  } catch (error) {
    return {
      reviews: [] as ReviewListItem[],
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
      error: error instanceof Error ? error.message : "Unable to load reviews.",
      search: search ?? "",
      status: status ?? "",
      rating: ratingValue ?? "",
      product: product ?? "",
      dateFrom: dateFrom ?? "",
      dateTo: dateTo ?? "",
      verifiedPurchase,
      prevCursor: prevCursor ?? "",
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  try {
    if (intent === "approve" || intent === "reject") {
      const reviewId = String(formData.get("reviewId") || "");

      if (!reviewId) {
        return { ok: false, error: "Missing review id." };
      }

      if (intent === "approve") {
        await reviewService.approveReview(reviewId);
      } else {
        await reviewService.rejectReview(reviewId);
      }
      return { ok: true, intent, message: intent === "approve" ? "Review approved." : "Review rejected." };
    }

    if (intent === "delete") {
      const reviewId = String(formData.get("reviewId") || "");

      if (!reviewId) {
        return { ok: false, error: "Missing review id." };
      }

      await reviewService.softDelete(reviewId);
      return { ok: true, intent, message: "Review deleted." };
    }

    if (intent === "reply") {
      return { ok: false, error: "Unsupported reply action." };
    }

    if (intent === "replyCreate") {
      const reviewId = String(formData.get("reviewId") || "");
      const reply = String(formData.get("reply") || "");

      if (!reviewId) {
        return { ok: false, error: "Missing review id." };
      }

      await reviewService.replyToReview(reviewId, reply);
      return { ok: true, intent, message: "Reply published." };
    }

    if (intent === "replyUpdate") {
      const reviewId = String(formData.get("reviewId") || "");
      const reply = String(formData.get("reply") || "");

      if (!reviewId) {
        return { ok: false, error: "Missing review id." };
      }

      await reviewService.updateReply(reviewId, reply);
      return { ok: true, intent, message: "Reply updated." };
    }

    if (intent === "replyDelete") {
      const reviewId = String(formData.get("reviewId") || "");

      if (!reviewId) {
        return { ok: false, error: "Missing review id." };
      }

      await reviewService.deleteReply(reviewId);
      return { ok: true, intent, message: "Reply deleted." };
    }

    if (intent === "bulkApprove" || intent === "bulkReject" || intent === "bulkDelete") {
      const ids = formData
        .getAll("reviewIds")
        .map((entry) => String(entry))
        .filter(Boolean);

      if (ids.length === 0) {
        return { ok: false, error: "No reviews selected." };
      }

      if (intent === "bulkDelete") {
        await reviewService.bulkSoftDelete(ids);
        return { ok: true, intent, message: "Selected reviews deleted." };
      }

      await reviewService.bulkModerate(ids, intent === "bulkApprove" ? "approved" : "rejected");
      return {
        ok: true,
        intent,
        message: intent === "bulkApprove" ? "Selected reviews approved." : "Selected reviews rejected.",
      };
    }

    return { ok: false, error: "Unsupported action." };
  } catch (error) {
    return {
      ok: false,
      intent,
      error: error instanceof Error ? error.message : "Action failed.",
    };
  }
};

const formatStatusLabel = (status: string) =>
  status.length > 0 ? `${status.charAt(0).toUpperCase()}${status.slice(1)}` : "Pending";

const statusClassFor = (status: string) => {
  const normalized = status.toLowerCase();

  if (normalized === "approved") {
    return styles.statusApproved;
  }

  if (normalized === "rejected") {
    return styles.statusRejected;
  }

  return styles.statusPending;
};

const formatShortDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));

const formatLongDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

export default function ReviewsPage() {
  const {
    reviews,
    nextCursor,
    hasMore,
    totalCount,
    error,
    search: initialSearch,
    status: initialStatus,
    rating: initialRating,
    product: initialProduct,
    dateFrom: initialDateFrom,
    dateTo: initialDateTo,
    verifiedPurchase: initialVerifiedPurchase,
    prevCursor: initialPrevCursor,
  } = useLoaderData<typeof loader>();

  const mutationFetcher = useFetcher<ActionData>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isLoading = navigation.state !== "idle";
  const isMutating = mutationFetcher.state !== "idle";

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);
  const [isReplyEditing, setIsReplyEditing] = useState(false);

  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, string>>({});
  const [optimisticDeleted, setOptimisticDeleted] = useState<Record<string, true>>({});
  const [optimisticReply, setOptimisticReply] = useState<Partial<Record<string, string | null>>>({});
  const [optimisticRepliedAt, setOptimisticRepliedAt] = useState<Partial<Record<string, Date | null>>>({});

  useEffect(() => {
    setSearchInput(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    if (!mutationFetcher.data) {
      return;
    }

    if (!mutationFetcher.data.ok) {
      setMutationError(mutationFetcher.data.error || "Action failed.");
      setToastState({ content: mutationFetcher.data.error || "Action failed.", error: true });
      setOptimisticStatus({});
      setOptimisticDeleted({});
      setOptimisticReply({});
      setOptimisticRepliedAt({});
      return;
    }

    setMutationError(null);
    setToastState({ content: mutationFetcher.data.message || "Review updated." });
    setSelectedIds([]);
    setOptimisticStatus({});
    setOptimisticDeleted({});
    setOptimisticReply({});
    setOptimisticRepliedAt({});
    if (mutationFetcher.data.intent?.startsWith("reply")) {
      setIsReplyEditing(false);
    }
    revalidator.revalidate();
  }, [mutationFetcher.data, revalidator]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      const trimmedSearch = searchInput.trim();

      if (trimmedSearch) {
        next.set("search", trimmedSearch);
      } else {
        next.delete("search");
      }

      next.delete("cursor");
      next.delete("prevCursor");
      setSearchParams(next);
    }, 280);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput, searchParams, setSearchParams]);

  const updateQuery = (updates: Record<string, string | boolean | undefined>, resetPagination = true) => {
    const next = new URLSearchParams(searchParams);

    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === "" || value === false) {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    });

    if (resetPagination) {
      next.delete("cursor");
      next.delete("prevCursor");
    }

    setSearchParams(next);
  };

  const effectiveReviews = useMemo(() => {
    return reviews
      .filter((review) => !optimisticDeleted[review.id])
      .map((review) => ({
        ...review,
        status: optimisticStatus[review.id] || review.status,
        merchantReply: optimisticReply[review.id] !== undefined ? optimisticReply[review.id] ?? null : review.merchantReply,
        repliedAt: optimisticRepliedAt[review.id] !== undefined ? optimisticRepliedAt[review.id] ?? null : review.repliedAt,
      }));
  }, [reviews, optimisticDeleted, optimisticStatus, optimisticReply, optimisticRepliedAt]);

  useEffect(() => {
    if (isLoading || isMutating) {
      return;
    }

    if (effectiveReviews.length === 0) {
      setSelectedReviewId(null);
      return;
    }

    if (!selectedReviewId || !effectiveReviews.some((review) => review.id === selectedReviewId)) {
      setSelectedReviewId(effectiveReviews[0].id);
    }
  }, [effectiveReviews, selectedReviewId, isLoading, isMutating]);

  const selectedReview = useMemo(
    () => effectiveReviews.find((review) => review.id === selectedReviewId) ?? null,
    [effectiveReviews, selectedReviewId],
  );

  useEffect(() => {
    setReplyDraft(selectedReview?.merchantReply ?? "");
    setIsReplyEditing(!selectedReview?.merchantReply);
  }, [selectedReview?.id, selectedReview?.merchantReply]);

  const activeIntent = mutationFetcher.formData?.get("_intent")?.toString() ?? "";
  const isReplySaving = mutationFetcher.state !== "idle" && activeIntent.startsWith("reply");

  const renderStars = (rating: number) =>
    Array.from({ length: 5 }, (_, index) => (
      <svg
        key={index}
        viewBox="0 0 24 24"
        className={styles.starIcon}
        aria-hidden="true"
        style={{ opacity: index < rating ? 1 : 0.22 }}
      >
        <path d="M12 2.75l2.84 5.75 6.36.92-4.6 4.48 1.09 6.34L12 17.46l-5.69 3.18 1.09-6.34-4.6-4.48 6.36-.92L12 2.75z" />
      </svg>
    ));

  const submitMutation = (payload: Record<string, string | string[]>) => {
    const formData = new FormData();

    Object.entries(payload).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => formData.append(key, item));
      } else {
        formData.append(key, value);
      }
    });

    mutationFetcher.submit(formData, { method: "post" });
  };

  const applySingleStatus = (reviewId: string, status: "approved" | "rejected") => {
    setMutationError(null);
    setOptimisticStatus((prev) => ({ ...prev, [reviewId]: status }));
    submitMutation({ _intent: status === "approved" ? "approve" : "reject", reviewId });
  };

  const applySingleDelete = (reviewId: string) => {
    setMutationError(null);
    setOptimisticDeleted((prev) => ({ ...prev, [reviewId]: true }));
    setSelectedIds((prev) => prev.filter((id) => id !== reviewId));
    submitMutation({ _intent: "delete", reviewId });
  };

  const applyReply = (reviewId: string, reply: string) => {
    setMutationError(null);
    const trimmedReply = reply.trim();
    const nextIntent = selectedReview?.merchantReply ? "replyUpdate" : "replyCreate";
    setOptimisticReply((prev) => ({ ...prev, [reviewId]: trimmedReply }));
    setOptimisticRepliedAt((prev) => ({ ...prev, [reviewId]: new Date() }));
    submitMutation({ _intent: nextIntent, reviewId, reply: trimmedReply });
  };

  const deleteReply = (reviewId: string) => {
    setMutationError(null);
    setOptimisticReply((prev) => ({ ...prev, [reviewId]: null }));
    setOptimisticRepliedAt((prev) => ({ ...prev, [reviewId]: null }));
    submitMutation({ _intent: "replyDelete", reviewId });
  };

  const applyBulkAction = (intent: "bulkApprove" | "bulkReject" | "bulkDelete") => {
    if (selectedIds.length === 0) {
      return;
    }

    setMutationError(null);

    if (intent === "bulkDelete") {
      setOptimisticDeleted((prev) => {
        const next = { ...prev };
        selectedIds.forEach((id) => {
          next[id] = true;
        });
        return next;
      });
    } else {
      const status = intent === "bulkApprove" ? "approved" : "rejected";
      setOptimisticStatus((prev) => {
        const next = { ...prev };
        selectedIds.forEach((id) => {
          next[id] = status;
        });
        return next;
      });
    }

    submitMutation({ _intent: intent, reviewIds: selectedIds });
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (effectiveReviews.length === 0) {
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();

    const currentIndex = effectiveReviews.findIndex((review) => review.id === selectedReviewId);
    const safeIndex = currentIndex < 0 ? 0 : currentIndex;

    if (event.key === "ArrowDown") {
      const nextIndex = Math.min(safeIndex + 1, effectiveReviews.length - 1);
      setSelectedReviewId(effectiveReviews[nextIndex].id);
      return;
    }

    const nextIndex = Math.max(safeIndex - 1, 0);
    setSelectedReviewId(effectiveReviews[nextIndex].id);
  };

  const toggleSelection = (reviewId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        if (prev.includes(reviewId)) {
          return prev;
        }

        return [...prev, reviewId];
      }

      return prev.filter((id) => id !== reviewId);
    });
  };

  const toggleSelectAllOnPage = (checked: boolean) => {
    if (!checked) {
      setSelectedIds([]);
      return;
    }

    setSelectedIds(effectiveReviews.map((review) => review.id));
  };

  const allPageSelected =
    effectiveReviews.length > 0 && effectiveReviews.every((review) => selectedIds.includes(review.id));

  return (
    <PolarisAppProvider i18n={enTranslations}>
      <Container as="main">
      <div className={`${shellStyles.page} ${styles.page}`}>
        <header className={`${shellStyles.header} ${styles.header}`}>
          <div className={`${shellStyles.headerContent} ${styles.headerContent}`}>
            <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
            <h1 className={`${shellStyles.title} ${styles.title}`}>Reviews</h1>
            <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>
              Moderate feedback with live workflow actions and bulk operations.
            </p>
          </div>
        </header>

        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <input
              className={styles.searchInput}
              type="search"
              placeholder="Search reviews, customers, or text"
              aria-label="Search reviews"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>

          <div className={styles.toolbarControls}>
            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Status</span>
              <select
                className={styles.filterSelect}
                value={initialStatus}
                onChange={(event) => updateQuery({ status: event.target.value || undefined })}
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>

            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Rating</span>
              <select
                className={styles.filterSelect}
                value={initialRating}
                onChange={(event) => updateQuery({ rating: event.target.value || undefined })}
              >
                <option value="">Any</option>
                <option value="5">5 stars</option>
                <option value="4">4 stars</option>
                <option value="3">3 stars</option>
                <option value="2">2 stars</option>
                <option value="1">1 star</option>
              </select>
            </label>

            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Product</span>
              <input
                className={styles.filterInput}
                type="text"
                value={initialProduct}
                onChange={(event) => updateQuery({ product: event.target.value || undefined })}
                placeholder="Any product"
              />
            </label>

            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Date from</span>
              <input
                className={styles.filterInput}
                type="date"
                value={initialDateFrom}
                onChange={(event) => updateQuery({ dateFrom: event.target.value || undefined })}
              />
            </label>

            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Date to</span>
              <input
                className={styles.filterInput}
                type="date"
                value={initialDateTo}
                onChange={(event) => updateQuery({ dateTo: event.target.value || undefined })}
              />
            </label>

            <label className={styles.checkboxGroup}>
              <input
                className={styles.checkboxInput}
                type="checkbox"
                checked={initialVerifiedPurchase}
                onChange={(event) => updateQuery({ verifiedPurchase: event.target.checked })}
              />
              <span className={styles.checkboxLabel}>Verified purchase</span>
            </label>
          </div>
        </div>

        {mutationError ? <p className={styles.feedbackError}>{mutationError}</p> : null}
        {isLoading ? <p className={styles.feedbackMuted}>Refreshing review results...</p> : null}

        <Section
          title="Review management"
          description={`Showing ${totalCount} review${totalCount === 1 ? "" : "s"}.`}
          actions={
            <div className={styles.bulkActions}>
              <label className={styles.bulkSelectAll}>
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={(event) => toggleSelectAllOnPage(event.target.checked)}
                  disabled={isLoading || isMutating || effectiveReviews.length === 0}
                />
                <span>Select page</span>
              </label>
              <span className={styles.bulkCount}>{selectedIds.length} selected</span>
              <Button
                type="button"
                onClick={() => applyBulkAction("bulkApprove")}
                disabled={selectedIds.length === 0 || isMutating}
              >
                Approve
              </Button>
              <Button
                type="button"
                onClick={() => applyBulkAction("bulkReject")}
                disabled={selectedIds.length === 0 || isMutating}
              >
                Reject
              </Button>
              <Button
                type="button"
                onClick={() => applyBulkAction("bulkDelete")}
                disabled={selectedIds.length === 0 || isMutating}
              >
                Delete
              </Button>
            </div>
          }
        >
          <div className={styles.splitLayout}>
            {isLoading ? (
              <>
                <div className={styles.listColumn}>
                  <div className={styles.skeletonList} aria-hidden="true">
                    {Array.from({ length: 6 }, (_, index) => (
                      <div key={index} className={styles.skeletonRow} />
                    ))}
                  </div>
                </div>
                <aside className={styles.detailPanel} aria-hidden="true">
                  <div className={styles.skeletonTitle} />
                  <div className={styles.skeletonParagraph} />
                  <div className={styles.skeletonParagraph} />
                  <div className={styles.skeletonBlock} />
                  <div className={styles.skeletonBlock} />
                </aside>
              </>
            ) : error ? (
              <div className={styles.errorState} role="alert">
                <h2 className={styles.errorStateTitle}>Unable to load reviews</h2>
                <p className={styles.errorStateText}>{error}</p>
                <Button type="button" onClick={() => window.location.reload()}>
                  Try again
                </Button>
              </div>
            ) : effectiveReviews.length === 0 ? (
              <>
                <div className={styles.emptyState}>
                  <h2 className={styles.emptyStateTitle}>No reviews matched your filters</h2>
                  <p className={styles.emptyStateText}>
                    Try broadening your criteria or clearing filters to review the full stream.
                  </p>
                  <Button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      setSearchParams(new URLSearchParams());
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
                <aside className={styles.detailPanel}>
                  <p className={styles.detailEyebrow}>Review details</p>
                  <h2 className={styles.detailTitle}>Select a review</h2>
                  <p className={styles.detailText}>
                    Full review details, moderation actions, and merchant reply appear once a review is selected.
                  </p>
                </aside>
              </>
            ) : (
              <>
                <div className={styles.listColumn} onKeyDown={onListKeyDown}>
                  <div className={styles.listScroll}>
                    <div className={styles.list}>
                      {effectiveReviews.map((review) => {
                        const isSelected = review.id === selectedReviewId;
                        const rating = review.rating ?? 0;
                        const reviewTitle = review.title ?? "Untitled review";
                        const customerName = review.authorName ?? "Anonymous";
                        const productName = review.product?.name ?? "Unassigned product";
                        const previewText = review.body?.trim() || "No review text captured yet.";
                        const checked = selectedIds.includes(review.id);

                        return (
                          <article
                            key={review.id}
                            className={`${styles.reviewRow} ${isSelected ? styles.reviewRowSelected : ""}`}
                            onClick={() => setSelectedReviewId(review.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedReviewId(review.id);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            aria-pressed={isSelected}
                          >
                            <div className={styles.reviewMain}>
                              <label className={styles.rowCheckbox}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => toggleSelection(review.id, event.target.checked)}
                                />
                              </label>
                              <div className={styles.rating} aria-label={`${rating} out of 5 stars`}>
                                {renderStars(rating)}
                              </div>
                              <div className={styles.reviewContent}>
                                <div className={styles.reviewHeaderLine}>
                                  <h2 className={styles.reviewTitle}>{reviewTitle}</h2>
                                  <span className={`${styles.statusPill} ${statusClassFor(review.status)}`}>
                                    {formatStatusLabel(review.status)}
                                  </span>
                                </div>
                                <p className={styles.reviewMeta}>
                                  {customerName} • {productName}
                                </p>
                                <p className={styles.reviewPreview}>{previewText}</p>
                                {review.verifiedPurchase ? (
                                  <span className={styles.verifiedBadge}>Verified purchase</span>
                                ) : null}
                              </div>
                            </div>
                            <p className={styles.reviewDate}>{formatShortDate(review.createdAt)}</p>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {selectedReview ? (
                  <aside className={styles.detailPanel} aria-label="Review details">
                    <div className={styles.detailHeader}>
                      <div className={styles.detailTopRow}>
                        <p className={styles.detailEyebrow}>Selected review</p>
                        <span className={`${styles.statusPill} ${statusClassFor(selectedReview.status)}`}>
                          {formatStatusLabel(selectedReview.status)}
                        </span>
                      </div>
                      <h2 className={styles.detailTitle}>{selectedReview.title ?? "Untitled review"}</h2>
                      <div className={styles.detailMetaRow}>
                        <span className={styles.verifiedBadge}>
                          {selectedReview.verifiedPurchase ? "Verified purchase" : "Unverified"}
                        </span>
                        <span className={styles.detailDate}>{formatLongDate(selectedReview.createdAt)}</span>
                      </div>
                    </div>

                    <div className={styles.detailActions}>
                      <ButtonGroup>
                        <PolarisButton onClick={() => applySingleStatus(selectedReview.id, "approved")} disabled={isMutating}>
                          Approve
                        </PolarisButton>
                        <PolarisButton onClick={() => applySingleStatus(selectedReview.id, "rejected")} disabled={isMutating}>
                          Reject
                        </PolarisButton>
                        <PolarisButton onClick={() => applySingleDelete(selectedReview.id)} disabled={isMutating}>
                          Delete
                        </PolarisButton>
                      </ButtonGroup>
                    </div>

                    <div className={styles.detailSummary}>
                      <div className={styles.ratingLarge} aria-label={`${selectedReview.rating ?? 0} out of 5 stars`}>
                        {renderStars(selectedReview.rating ?? 0)}
                      </div>
                      <p className={styles.detailText}>{selectedReview.body ?? "No review text has been provided yet."}</p>
                    </div>

                    <dl className={styles.detailMetaList}>
                      <div className={styles.detailMetaItem}>
                        <dt className={styles.detailLabel}>Customer name</dt>
                        <dd className={styles.detailValue}>{selectedReview.authorName ?? "Anonymous"}</dd>
                      </div>
                      <div className={styles.detailMetaItem}>
                        <dt className={styles.detailLabel}>Customer email</dt>
                        <dd className={styles.detailValue}>{selectedReview.authorEmail ?? "Not provided"}</dd>
                      </div>
                      <div className={styles.detailMetaItem}>
                        <dt className={styles.detailLabel}>Product info</dt>
                        <dd className={styles.detailValue}>{selectedReview.product?.name ?? "Unassigned product"}</dd>
                      </div>
                      <div className={styles.detailMetaItem}>
                        <dt className={styles.detailLabel}>Rating</dt>
                        <dd className={styles.detailValue}>{selectedReview.rating ?? 0} / 5</dd>
                      </div>
                      <div className={styles.detailMetaItem}>
                        <dt className={styles.detailLabel}>Status</dt>
                        <dd className={styles.detailValue}>{formatStatusLabel(selectedReview.status)}</dd>
                      </div>
                      <div className={styles.detailMetaItem}>
                        <dt className={styles.detailLabel}>Created date</dt>
                        <dd className={styles.detailValue}>{formatLongDate(selectedReview.createdAt)}</dd>
                      </div>
                    </dl>

                    <div className={styles.detailSection}>
                      <div className={styles.detailSectionHeader}>
                        <h3 className={styles.detailSectionTitle}>Uploaded photos</h3>
                        <span className={styles.detailSectionHint}>Media</span>
                      </div>
                      {(selectedReview.photoUrls ?? "").trim() ? (
                        <div className={styles.photoGrid}>
                          {selectedReview.photoUrls
                            ?.split(",")
                            .map((url) => url.trim())
                            .filter(Boolean)
                            .slice(0, 4)
                            .map((url) => (
                              <div key={url} className={styles.photoItem}>
                                <img className={styles.photoImage} src={url} alt="Review attachment" loading="lazy" />
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className={styles.placeholderBox}>No photos have been uploaded for this review yet.</div>
                      )}
                    </div>

                    <div className={styles.detailSection}>
                      <div className={styles.detailSectionHeader}>
                        <h3 className={styles.detailSectionTitle}>Merchant reply</h3>
                        <span className={styles.detailSectionHint}>Merchant response</span>
                      </div>
                      {selectedReview.merchantReply && !isReplyEditing ? (
                        <>
                          <div className={styles.replyDisplay}>{selectedReview.merchantReply}</div>
                          <div className={styles.replyMetaRow}>
                            <span className={styles.replyMetaText}>
                              {selectedReview.repliedAt
                                ? `Last updated ${formatLongDate(selectedReview.repliedAt)}`
                                : "Published reply"}
                            </span>
                          </div>
                          <div className={styles.replyActions}>
                            <Button type="button" onClick={() => setIsReplyEditing(true)} disabled={isReplySaving}>
                              Edit
                            </Button>
                            <Button type="button" onClick={() => deleteReply(selectedReview.id)} disabled={isReplySaving}>
                              Delete
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className={styles.replyField}>
                            <TextField
                              label="Merchant reply"
                              labelHidden
                              value={replyDraft}
                              onChange={setReplyDraft}
                              autoComplete="off"
                              multiline={4}
                              placeholder="Write a public reply to this review"
                              disabled={isReplySaving}
                            />
                          </div>
                          <div className={styles.replyActions}>
                            <Button
                              type="button"
                              onClick={() => applyReply(selectedReview.id, replyDraft)}
                              disabled={isReplySaving || replyDraft.trim().length === 0}
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              onClick={() => {
                                setReplyDraft(selectedReview.merchantReply ?? "");
                                setIsReplyEditing(false);
                              }}
                              disabled={isReplySaving}
                            >
                              Cancel
                            </Button>
                            {selectedReview.merchantReply ? (
                              <Button
                                type="button"
                                onClick={() => deleteReply(selectedReview.id)}
                                disabled={isReplySaving}
                              >
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                  </aside>
                ) : null}
              </>
            )}
          </div>

          <div className={styles.pagination}>
            <button
              className={styles.paginationButton}
              type="button"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                if (initialPrevCursor) {
                  next.set("cursor", initialPrevCursor);
                  next.delete("prevCursor");
                } else {
                  next.delete("cursor");
                }
                setSearchParams(next);
              }}
              disabled={!initialPrevCursor || isLoading || isMutating}
            >
              Previous
            </button>
            <button
              className={styles.paginationButton}
              type="button"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                if (nextCursor) {
                  next.set("cursor", nextCursor);
                  next.set("prevCursor", searchParams.get("cursor") ?? initialPrevCursor ?? "");
                }
                setSearchParams(next);
              }}
              disabled={!hasMore || !nextCursor || isLoading || isMutating}
            >
              Next
            </button>
          </div>
        </Section>
      </div>
      </Container>
      <Frame>
        {toastState ? (
          <Toast content={toastState.content} error={toastState.error} onDismiss={() => setToastState(null)} />
        ) : null}
      </Frame>
    </PolarisAppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
