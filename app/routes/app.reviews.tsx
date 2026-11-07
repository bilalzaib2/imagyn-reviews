import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Link as RemixLink,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigation,
  useRevalidator,
  useRouteError,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import Papa from "papaparse";
import { ActionList, Frame, Modal, Popover, TextField, Toast } from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Table, type TableColumn } from "../components/ui/Table";
import { WorkspaceTabs } from "../components/ui/WorkspaceTabs";
import { REVIEW_WORKSPACE_TABS } from "../components/ui/reviewWorkspaceTabs";
import { Container } from "../components/ui/Container";
import { LinkButton } from "../components/ui/LinkButton";
import { Section } from "../components/ui/Section";
import { Banner } from "../components/ui/Banner";
import { ReviewStatusBadge } from "../components/reviews/ReviewStatusBadge";
import { VerifiedBadge } from "../components/reviews/VerifiedBadge";
import { ImportedBadge } from "../components/reviews/ImportedBadge";
import { FeaturedBadge } from "../components/reviews/FeaturedBadge";
import { RewardBadge } from "../components/reviews/RewardBadge";
import { StarRating } from "../components/reviews/StarRating";
import {
  approveReview,
  bulkDeleteReviews,
  bulkModerateReviews,
  deleteReply,
  deleteReview,
  getStoreReview,
  getStoreReviews,
  getStoreReviewStatusCounts,
  archiveReview,
  unarchiveReview,
  bulkSetReviewArchived,
  rejectReview,
  replyToReview,
  type ReviewWithProduct,
} from "../services/review.server";
import { deleteReviewMedia } from "../services/reviewMedia.server";
import { getAiSummariesForProducts, type ProductAiSummaryRecord } from "../services/aiSummary.server";
import { draftReplyForReview } from "../services/aiReplyDraft.server";
import {
  AI_REPLY_TONES,
  AI_REPLY_TONE_LABELS,
  DEFAULT_AI_REPLY_TONE,
  isAiReplyTone,
  type AiReplyTone,
} from "../services/ai/replyTone.shared";
import { syncProductStructuredData } from "../services/structuredData/sync.server";
import { REVIEW_HIDE_REASONS, ReviewStatus, reviewHideReasonLabel, type ReviewHideReasonId } from "../services/review.shared";
import { IMPORT_SOURCES, type ImportSource } from "../services/importers/types";
import { importReviews, type ImportResult } from "../services/reviewImportExport.server";
import { getOrCreateStore } from "../services/store.server";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import {
  historyForNextPage,
  historyForPreviousPage,
  pageNumberFor,
  parseCursorHistory,
  rangeFor,
  totalPagesFor,
} from "../services/cursorPagination.shared";
import styles from "../styles/app.reviews.module.css";
import shellStyles from "../styles/app.shell.module.css";

type ActionData = {
  ok: boolean;
  intent?: string;
  error?: string;
  message?: string;
  importResult?: ImportResult;
  draft?: string;
};

const STATUS_VALUES: string[] = Object.values(ReviewStatus);

// Drives the compact status segmented control in the toolbar (replaces a <select>) — "" means
// "All", matching how the loader already treats a missing/empty status param.
// Four statuses plus the Archive. Archive is not a status — an archived review keeps whatever
// status it had — so it is marked and handled as a separate axis rather than another value.
const STATUS_FILTER_OPTIONS: Array<{ label: string; value: string; archive?: true }> = [
  { label: "All", value: "" },
  { label: "Pending", value: ReviewStatus.PENDING },
  { label: "Approved", value: ReviewStatus.APPROVED },
  { label: "Rejected", value: ReviewStatus.REJECTED },
  { label: "Archive", value: "", archive: true },
];

// How many photo thumbnails the detail panel shows before collapsing the rest behind a
// "+N" chip — keeps the panel compact without ever hiding a photo's delete action, since
// clicking the chip reveals the rest (see showAllPhotos below).
const PHOTO_PREVIEW_COUNT = 4;

// Shared by the loader (query page size) and the component (computing total page count and
// the "Showing X–Y of Z" range) so the two can never drift apart.
const REVIEWS_PAGE_SIZE = 25;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || undefined;
  const statusParam = url.searchParams.get("status")?.trim() || undefined;
  const status = statusParam && STATUS_VALUES.includes(statusParam) ? (statusParam as ReviewStatus) : undefined;
  const ratingValue = url.searchParams.get("rating");
  const parsedRating = ratingValue ? Number(ratingValue) : undefined;
  const rating = Number.isFinite(parsedRating) ? parsedRating : undefined;
  const product = url.searchParams.get("product")?.trim() || undefined;
  const dateFrom = url.searchParams.get("dateFrom") || undefined;
  const dateTo = url.searchParams.get("dateTo") || undefined;
  const verifiedPurchase = url.searchParams.get("verifiedPurchase") === "true";
  // The Archive is its own view rather than another status: archived reviews keep whatever
  // status they were archived with, so the two axes are independent.
  const archived = url.searchParams.get("archived") === "1";
  // Only ever the cursor for the CURRENT page — the client derives page number and
  // Previous-button behavior from its own `history` URL param (an accumulated stack of every
  // cursor visited), which the loader never needs to see: it only has to run the query for
  // whichever single page is currently requested. See the component's cursorHistory/
  // goToNextPage/goToPreviousPage for that logic.
  const cursor = url.searchParams.get("cursor") || undefined;
  const sortParam = url.searchParams.get("sort")?.trim() === "helpful" ? "helpful" : "newest";
  // Deep-link entry point, used by the merchant's new-review notification email (see
  // reviewNotifications.server.ts's buildReviewAdminUrl/buildReviewReplyUrl, the single source
  // of truth for these two parameter names): `review` preselects one specific review, and
  // `reply=1` additionally opens its reply editor. Both are ordinary optional params — the page
  // behaves exactly as before when neither is present.
  const requestedReviewId = url.searchParams.get("review")?.trim() || "";
  const wantsReplyEditor = url.searchParams.get("reply") === "1";

  try {
    const result = await getStoreReviews(store.id, {
      search,
      status,
      rating,
      product,
      dateFrom,
      dateTo,
      verifiedPurchase: verifiedPurchase || undefined,
      cursor,
      limit: REVIEWS_PAGE_SIZE,
      sort: sortParam,
      archived,
    });

    // Batched, not per-review — bounded by this page's own REVIEWS_PAGE_SIZE-review limit,
    // and a pure cache read (see getAiSummariesForProducts), so this never triggers AI
    // generation.
    // A deep-linked review is very often not on the current page of the current filter (or is
    // excluded by it outright), so it's fetched explicitly and prepended rather than left to
    // the merchant to go hunting for. Store-scoped in the same query that resolves it (see
    // getStoreReview), so another store's id simply resolves to nothing and the page renders
    // normally with no selection forced — never an error, and never another store's data.
    let reviews = result.reviews;
    let focusReviewId = "";

    if (requestedReviewId) {
      const alreadyOnPage = reviews.some((review) => review.id === requestedReviewId);

      if (alreadyOnPage) {
        focusReviewId = requestedReviewId;
      } else {
        const focused = await getStoreReview(store.id, requestedReviewId);
        if (focused) {
          reviews = [focused, ...reviews];
          focusReviewId = focused.id;
        }
      }
    }

    const productIds = Array.from(new Set(reviews.map((review) => review.productId)));
    // One grouped query beside the summaries, so the status tabs can carry counts without a
    // second round trip. Shares the list's own filters — see getStoreReviewStatusCounts.
    const [aiSummaries, statusCounts] = await Promise.all([
      getAiSummariesForProducts(productIds),
      getStoreReviewStatusCounts(store.id, {
        search,
        rating,
        product,
        dateFrom,
        dateTo,
        verifiedPurchase: verifiedPurchase || undefined,
      }),
    ]);

    return {
      reviews,
      statusCounts,
      focusReviewId,
      focusReplyEditor: Boolean(focusReviewId) && wantsReplyEditor,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      totalCount: result.totalCount,
      aiSummaries,
      error: null as string | null,
      search: search ?? "",
      status: statusParam ?? "",
      rating: ratingValue ?? "",
      product: product ?? "",
      dateFrom: dateFrom ?? "",
      dateTo: dateTo ?? "",
      verifiedPurchase,
      archived,
      sort: sortParam,
    };
  } catch (error) {
    return {
      reviews: [] as ReviewWithProduct[],
      statusCounts: { all: 0, archived: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 },
      focusReviewId: "",
      focusReplyEditor: false,
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
      aiSummaries: {} as Record<string, ProductAiSummaryRecord>,
      error: error instanceof Error ? error.message : "Unable to load reviews.",
      search: search ?? "",
      status: statusParam ?? "",
      rating: ratingValue ?? "",
      product: product ?? "",
      dateFrom: dateFrom ?? "",
      dateTo: dateTo ?? "",
      verifiedPurchase,
      archived,
      sort: sortParam,
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { admin, session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  try {
    if (intent === "import-csv") {
      const fileContent = String(formData.get("fileContent") || "");
      const source = (String(formData.get("source") || "csv")) as ImportSource;
      const dryRun = formData.get("dryRun") === "true";

      if (!fileContent.trim()) {
        return { ok: false, intent, error: "The file is empty." };
      }

      const result = await importReviews(store.id, source, fileContent, admin, dryRun);
      const nothingHappened = result.imported === 0 && result.duplicates === 0 && result.titlesRepaired === 0;
      const hasIssues = result.errors.length > 0 || result.missingProducts.length > 0;

      if (nothingHappened && hasIssues) {
        return {
          ok: false,
          intent,
          error: dryRun ? "Dry run: no rows would be imported. See the details below." : "No rows could be imported. See the details below.",
          importResult: result,
        };
      }

      const repairedNote = result.titlesRepaired > 0 ? ` ${result.titlesRepaired} existing review title${result.titlesRepaired === 1 ? "" : "s"} repaired.` : "";

      return {
        ok: true,
        intent,
        message: dryRun
          ? `Dry run complete — ${result.expectedImportedCount} review${result.expectedImportedCount === 1 ? "" : "s"} would be imported.${repairedNote} No changes were made.`
          : `Imported ${result.imported} review${result.imported === 1 ? "" : "s"}.${repairedNote}`,
        importResult: result,
      };
    }

    if (intent === "approve" || intent === "reject") {
      const reviewId = String(formData.get("reviewId") || "");

      if (!reviewId) {
        return { ok: false, error: "Missing review id." };
      }

      // Only read when hiding. parseReviewHideReason in the service rejects anything that is
      // not an offered id, so a hand-crafted POST cannot write arbitrary text into the
      // moderation record.
      const hideReason = formData.get("hideReason");

      const review =
        intent === "approve"
          ? await approveReview(store.id, reviewId)
          : await rejectReview(store.id, reviewId, hideReason);
      // Status just changed, which is the one thing the public review summary/JSON-LD
      // depends on — always resync, regardless of direction (approve adds a review to the
      // public set, reject removes one that may have been approved before).
      void syncProductStructuredData(admin, review.productId);
      return { ok: true, intent, message: intent === "approve" ? "Review approved." : "Review rejected." };
    }

    if (intent === "delete") {
      const reviewId = String(formData.get("reviewId") || "");

      if (!reviewId) {
        return { ok: false, error: "Missing review id." };
      }

      const review = await deleteReview(store.id, reviewId);
      void syncProductStructuredData(admin, review.productId);
      return { ok: true, intent, message: "Review deleted." };
    }

    if (intent === "draftReply") {
      const reviewId = String(formData.get("reviewId") || "");
      const existingDraft = String(formData.get("existingDraft") || "");

      if (!reviewId) {
        return { ok: false, error: "Missing review id." };
      }

      // Validated against the closed set rather than cast: this value reaches a system
      // prompt, so an unrecognised string must fall back to the default voice, never be
      // forwarded to the model.
      const rawTone = String(formData.get("replyTone") || "");
      const tone = isAiReplyTone(rawTone) ? rawTone : undefined;

      const result = await draftReplyForReview(store.id, reviewId, existingDraft || null, tone);
      return { ok: true, intent, draft: result.draft };
    }

    if (intent === "replyCreate" || intent === "replyUpdate") {
      const reviewId = String(formData.get("reviewId") || "");
      const reply = String(formData.get("reply") || "");

      if (!reviewId) {
        return { ok: false, error: "Missing review id." };
      }

      await replyToReview(store.id, reviewId, reply);
      return { ok: true, intent, message: intent === "replyCreate" ? "Reply published." : "Reply updated." };
    }

    if (intent === "replyDelete") {
      const reviewId = String(formData.get("reviewId") || "");

      if (!reviewId) {
        return { ok: false, error: "Missing review id." };
      }

      await deleteReply(store.id, reviewId);
      return { ok: true, intent, message: "Reply deleted." };
    }

    if (intent === "deleteMedia") {
      const mediaId = String(formData.get("mediaId") || "");

      if (!mediaId) {
        return { ok: false, error: "Missing media id." };
      }

      await deleteReviewMedia(store.id, mediaId);
      return { ok: true, intent, message: "Photo deleted." };
    }

    if (intent === "archive" || intent === "unarchive") {
      const reviewId = String(formData.get("reviewId") || "");
      if (!reviewId) return { ok: false, error: "Missing review id." };

      const review =
        intent === "archive" ? await archiveReview(store.id, reviewId) : await unarchiveReview(store.id, reviewId);
      // Archiving removes a review from the public set and restoring can put it back, so the
      // structured data for its product is stale either way.
      void syncProductStructuredData(admin, review.productId);
      return { ok: true, intent, message: intent === "archive" ? "Review archived." : "Review restored." };
    }

    if (intent === "bulkArchive" || intent === "bulkUnarchive") {
      const ids = formData
        .getAll("reviewIds")
        .map((entry) => String(entry))
        .filter(Boolean);

      if (ids.length === 0) return { ok: false, error: "No reviews selected." };

      const result = await bulkSetReviewArchived(store.id, ids, intent === "bulkArchive");
      void Promise.all(result.affectedProductIds.map((productId) => syncProductStructuredData(admin, productId)));
      return {
        ok: true,
        intent,
        message: intent === "bulkArchive" ? "Selected reviews archived." : "Selected reviews restored.",
      };
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
        const result = await bulkDeleteReviews(store.id, ids);
        void Promise.all(result.affectedProductIds.map((productId) => syncProductStructuredData(admin, productId)));
        return { ok: true, intent, message: "Selected reviews deleted." };
      }

      const result = await bulkModerateReviews(
        store.id,
        ids,
        intent === "bulkApprove" ? ReviewStatus.APPROVED : ReviewStatus.REJECTED,
        formData.get("hideReason"),
      );
      void Promise.all(result.affectedProductIds.map((productId) => syncProductStructuredData(admin, productId)));
      return {
        ok: true,
        intent,
        message: intent === "bulkApprove" ? "Selected reviews approved." : "Selected reviews rejected.",
      };
    }

    return { ok: false, error: "Unsupported action." };
  } catch (error) {
    // Logged here (not just returned to the client) so an unexpected failure — as opposed to
    // the normal, expected per-row rejections importReviews already logs itself — is still
    // diagnosable from Railway logs even if the merchant never reports the exact error text
    // shown in the UI.
    console.error(`[app.reviews] action "${intent}" failed:`, error);
    return {
      ok: false,
      intent,
      error: error instanceof Error ? error.message : "Action failed.",
    };
  }
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

const formatCount = (value: number) => new Intl.NumberFormat("en").format(value);

// Compact list-row signal icons — plain inline SVG, no external icon library (matches this
// codebase's existing ad-hoc inline-SVG convention). Each one only renders when its row
// actually has that real, true condition (see the callers below) — a row with none of these
// shows none of these, so the list stays quiet for the common case and only lights up for a
// review that's genuinely notable in that specific way.
function MediaIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="4.5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 4.5l1.2-1.8h2.6l1.2 1.8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="8" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 9.5c0-2.8 2.2-5 5-5s5 2.2 5 5-2.2 5-5 5H5.2L3 16v-3.2C3 11.8 3 10.6 3 9.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FeaturedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.6l1.85 3.75 4.15.6-3 2.93.7 4.13L8 11.05l-3.7 1.96.7-4.13-3-2.93 4.15-.6z" />
    </svg>
  );
}

export default function ReviewsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const {
    search: initialSearch,
    status: initialStatus,
    rating: initialRating,
    product: initialProduct,
    dateFrom: initialDateFrom,
    dateTo: initialDateTo,
    verifiedPurchase: initialVerifiedPurchase,
    sort: initialSort,
    focusReviewId,
    focusReplyEditor,
  } = loaderData;

  const mutationFetcher = useFetcher<ActionData>();
  const importFetcher = useFetcher<ActionData>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const location = useLocation();

  const [searchParams, setSearchParams] = useSearchParams();

  // Pagination is driven through this fetcher rather than `useSearchParams`. Reproduced live:
  // clicking Next changed the URL (cursor/history), the loader correctly returned page 2, and
  // the page briefly re-rendered with it — but Shopify Admin's embedded-app shell owns the
  // outer iframe URL via its NavMenu registration, doesn't recognize a plain History API
  // mutation (what useSearchParams does under the hood) as legitimate app-initiated navigation,
  // and silently reconciles the iframe back to its own last-known URL shortly after — landing
  // back on page 1 every time. This is the same root cause already diagnosed and fixed for the
  // Requests page (see that page's git history) — a fetcher re-runs the same loader over a
  // plain request without touching window.history, so there's nothing for the admin shell to
  // revert. Filters/search intentionally aren't touched by this fix — they still navigate via
  // setSearchParams, unchanged from before.
  const pageFetcher = useFetcher<typeof loader>();

  // Identifies the current filter/search/sort combination, so a page fetched under a
  // since-changed combination is never shown after the merchant changes a filter (a real
  // navigation that reruns the loader with fresh initialSearch/initialStatus/etc.).
  const filterKey = JSON.stringify([
    initialSearch,
    initialStatus,
    initialRating,
    initialProduct,
    initialDateFrom,
    initialDateTo,
    initialVerifiedPurchase,
    initialSort,
  ]);

  // `history` is a stack of every cursor visited to reach the current page — the client-side
  // page number a bare "cursor" scalar can't express on its own. Page number is its length + 1;
  // Previous pops the stack (restoring the exact cursor used to reach the prior page, not a
  // guess); Next pushes the current page's own nextCursor. Seeded once from the URL so an
  // existing bookmark/deep link into a specific page still lands there, but never written back
  // to the URL afterward (see pageFetcher above).
  const [cursorHistory, setCursorHistory] = useState<string[]>(() => parseCursorHistory(searchParams.get("history")));

  // Resets pagination to page 1 when the filter/search/sort combination changes — adjusting
  // state during render in response to a changed value, rather than in an effect that would
  // otherwise run one render late and flash the old page's data under the new filters.
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setCursorHistory([]);
  }

  // The filterKey that the data currently sitting in pageFetcher.data was fetched under — only
  // trusted while it still matches the current filters, so a stale fetched page can never be
  // shown after a filter change lands (a real navigation) but before the reset above commits.
  const pageFetcherEpochRef = useRef<string | null>(null);
  const activeData =
    pageFetcher.data && pageFetcherEpochRef.current === filterKey ? pageFetcher.data : loaderData;
  const { reviews, nextCursor, hasMore, totalCount, aiSummaries, statusCounts, error } = activeData;

  const isArchiveView = activeData.archived;

  /** The count for one status tab; "" is the All tab. */
  const statusCountFor = (status: string) =>
    status === "" ? statusCounts.all : (statusCounts[status as keyof typeof statusCounts] ?? 0);

  const isLoading = navigation.state !== "idle" || pageFetcher.state !== "idle";
  const isMutating = mutationFetcher.state !== "idle";

  const currentPage = pageNumberFor(cursorHistory);
  const totalPages = totalPagesFor(totalCount, REVIEWS_PAGE_SIZE);
  const { start: rangeStart, end: rangeEnd } = rangeFor(currentPage, REVIEWS_PAGE_SIZE, totalCount, reviews.length);

  const buildPageFetchUrl = (cursor?: string) => {
    const params = new URLSearchParams(searchParams);
    params.delete("cursor");
    params.delete("history");
    if (cursor) {
      params.set("cursor", cursor);
    }
    const queryString = params.toString();
    return queryString ? `/app/reviews?${queryString}` : "/app/reviews";
  };

  const goToPreviousPage = () => {
    if (cursorHistory.length === 0) return;
    const newHistory = historyForPreviousPage(cursorHistory);
    setCursorHistory(newHistory);
    pageFetcherEpochRef.current = filterKey;
    pageFetcher.load(buildPageFetchUrl(newHistory.length > 0 ? newHistory[newHistory.length - 1] : undefined));
  };

  const goToNextPage = () => {
    if (!nextCursor) return;
    setCursorHistory(historyForNextPage(cursorHistory, nextCursor));
    pageFetcherEpochRef.current = filterKey;
    pageFetcher.load(buildPageFetchUrl(nextCursor));
  };

  const [searchInput, setSearchInput] = useState(initialSearch);
  // Seeded from the deep link (`/app/reviews?review=<id>`) when the merchant arrived from a
  // new-review notification email, so the linked review is already selected on first paint
  // rather than being replaced by "first review in the list" by the effect below. The loader
  // only ever sets focusReviewId to a review this store genuinely owns, and guarantees it is
  // present in `reviews`.
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(focusReviewId || null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);
  const [isReplyEditing, setIsReplyEditing] = useState(false);
  /** The voice "Draft with AI" writes in. Deliberately NOT persisted per store: it is a
   *  per-reply choice (a complaint and a rave rarely want the same register), and a saved
   *  default would quietly apply a voice the merchant picked once for one awkward review. */
  const [replyTone, setReplyTone] = useState<AiReplyTone>(DEFAULT_AI_REPLY_TONE);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [moreActionsMenuOpen, setMoreActionsMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showAllPhotos, setShowAllPhotos] = useState(false);

  const activeFilterCount = [
    initialRating,
    initialProduct,
    initialDateFrom,
    initialDateTo,
    initialVerifiedPurchase ? "yes" : "",
    initialSort === "helpful" ? "yes" : "",
  ].filter(Boolean).length;

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importSource, setImportSource] = useState<ImportSource>("csv");
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importFileContent, setImportFileContent] = useState<string | null>(null);
  const [importPreviewRows, setImportPreviewRows] = useState<Record<string, string>[]>([]);
  const [importFileError, setImportFileError] = useState<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, ReviewStatus>>({});
  /** Which hide the reason prompt is open for, or null when it is closed. */
  const [hidePrompt, setHidePrompt] = useState<{ kind: "single"; reviewId: string } | { kind: "bulk" } | null>(null);
  /** The reason currently selected in that prompt. Defaults to the commonest one so the
   *  usual case is one click, while still being an explicit choice the merchant can see. */
  const [hideReason, setHideReason] = useState<ReviewHideReasonId>(REVIEW_HIDE_REASONS[0].id);
  const [optimisticDeleted, setOptimisticDeleted] = useState<Record<string, true>>({});
  const [optimisticReply, setOptimisticReply] = useState<Partial<Record<string, string | null>>>({});
  const [optimisticRepliedAt, setOptimisticRepliedAt] = useState<Partial<Record<string, Date | null>>>({});
  const [optimisticDeletedMediaIds, setOptimisticDeletedMediaIds] = useState<Record<string, true>>({});

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
      // A failed reply draft (e.g. the Pro-plan gate) never touched a review — the reply
      // form/optimistic state it was drafting for should stay exactly as the merchant left it.
      if (mutationFetcher.data.intent !== "draftReply") {
        setOptimisticStatus({});
        setOptimisticDeleted({});
        setOptimisticReply({});
        setOptimisticRepliedAt({});
        setOptimisticDeletedMediaIds({});
      }
      return;
    }

    // A draft never changes a review — just fills the (already-open) reply textarea with the
    // AI's suggestion for the merchant to review, edit, and publish themselves via the normal
    // Publish button. No revalidate (nothing in the DB changed) and no "Review updated" toast.
    if (mutationFetcher.data.intent === "draftReply") {
      setReplyDraft(mutationFetcher.data.draft || "");
      setIsReplyEditing(true);
      return;
    }

    setMutationError(null);
    setToastState({ content: mutationFetcher.data.message || "Review updated." });
    setSelectedIds([]);
    setOptimisticStatus({});
    setOptimisticDeleted({});
    setOptimisticReply({});
    setOptimisticRepliedAt({});
    setOptimisticDeletedMediaIds({});
    if (mutationFetcher.data.intent?.startsWith("reply")) {
      setIsReplyEditing(false);
    }
    revalidator.revalidate();
  }, [mutationFetcher.data, revalidator]);

  useEffect(() => {
    if (!importFetcher.data) {
      return;
    }

    if (importFetcher.data.ok) {
      setToastState({ content: importFetcher.data.message || "Import complete." });
      revalidator.revalidate();
    }
  }, [importFetcher.data, revalidator]);

  // `searchParams` deliberately isn't a dependency here — clicking Next/Previous also changes
  // searchParams (cursor/history), and if this effect re-ran on that change too, its debounce
  // timer would fire ~280ms later and unconditionally strip the cursor/history it just set,
  // snapping the merchant straight back to page 1. This should only ever fire in response to
  // the merchant actually typing in the search box. A ref keeps it reading the latest
  // searchParams when it does fire, without making that value a re-trigger source.
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const next = new URLSearchParams(searchParamsRef.current);
      const trimmedSearch = searchInput.trim();

      if (trimmedSearch) {
        next.set("search", trimmedSearch);
      } else {
        next.delete("search");
      }

      next.delete("cursor");
      next.delete("history");
      setSearchParams(next);
    }, 280);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput, setSearchParams]);

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
      next.delete("history");
    }

    setSearchParams(next);
  };

  const effectiveReviews = useMemo(() => {
    return reviews
      .filter((review) => !optimisticDeleted[review.id])
      .map((review) => ({
        ...review,
        status: optimisticStatus[review.id] || review.status,
        reply: optimisticReply[review.id] !== undefined ? optimisticReply[review.id] ?? null : review.reply,
        repliedAt:
          optimisticRepliedAt[review.id] !== undefined ? optimisticRepliedAt[review.id] ?? null : review.repliedAt,
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

  // Collapsed by default even when there's no reply yet — most of the imported reviews have
  // never been replied to, so defaulting to an open 4-row textarea for every single one of
  // them was the single biggest contributor to the panel's height. The compact "No reply yet"
  // prompt below expands it on click instead (same on-demand pattern as the photo strip).
  useEffect(() => {
    setReplyDraft(selectedReview?.reply ?? "");
    setIsReplyEditing(false);
  }, [selectedReview?.id, selectedReview?.reply]);

  // One-shot: honors `reply=1` from the notification email's "Reply to review" CTA by opening
  // that review's reply editor. Deliberately declared after the effect above that resets
  // isReplyEditing on every selection change — effects run in declaration order within the
  // same commit, so this wins for the initial focus — and consumed via a ref so a later manual
  // collapse is never re-opened behind the merchant's back.
  const replyIntentConsumedRef = useRef(false);
  useEffect(() => {
    if (replyIntentConsumedRef.current || !focusReplyEditor || !focusReviewId) {
      return;
    }
    if (selectedReview?.id !== focusReviewId) {
      return;
    }
    replyIntentConsumedRef.current = true;
    setIsReplyEditing(true);
  }, [focusReplyEditor, focusReviewId, selectedReview?.id]);

  useEffect(() => {
    setShowAllPhotos(false);
  }, [selectedReview?.id]);

  useEffect(() => {
    setActionsMenuOpen(false);
  }, [selectedReviewId]);

  const activeIntent = mutationFetcher.formData?.get("_intent")?.toString() ?? "";
  const isReplySaving = mutationFetcher.state !== "idle" && activeIntent.startsWith("reply");
  const isDraftingReply = mutationFetcher.state !== "idle" && activeIntent === "draftReply";
  const isImporting = importFetcher.state !== "idle";
  const previewHeaders = importPreviewRows.length > 0 ? Object.keys(importPreviewRows[0]) : [];

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

  const applySingleStatus = (reviewId: string, status: ReviewStatus) => {
    // Hiding always asks why first. Approving does not: restoring a review to the storefront
    // needs no justification, and a prompt there would only train merchants to dismiss it.
    if (status === ReviewStatus.REJECTED) {
      setHidePrompt({ kind: "single", reviewId });
      return;
    }

    setMutationError(null);
    setOptimisticStatus((prev) => ({ ...prev, [reviewId]: status }));
    submitMutation({ _intent: "approve", reviewId });
  };

  /** Carries out the hide the prompt was opened for, with the reason the merchant chose. */
  const confirmHide = () => {
    if (!hidePrompt) return;

    setMutationError(null);

    if (hidePrompt.kind === "single") {
      setOptimisticStatus((prev) => ({ ...prev, [hidePrompt.reviewId]: ReviewStatus.REJECTED }));
      submitMutation({ _intent: "reject", reviewId: hidePrompt.reviewId, hideReason });
    } else {
      setOptimisticStatus((prev) => {
        const next = { ...prev };
        selectedIds.forEach((id) => {
          next[id] = ReviewStatus.REJECTED;
        });
        return next;
      });
      submitMutation({ _intent: "bulkReject", reviewIds: selectedIds, hideReason });
      setSelectedIds([]);
    }

    setHidePrompt(null);
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
    const nextIntent = selectedReview?.reply ? "replyUpdate" : "replyCreate";
    setOptimisticReply((prev) => ({ ...prev, [reviewId]: trimmedReply }));
    setOptimisticRepliedAt((prev) => ({ ...prev, [reviewId]: new Date() }));
    submitMutation({ _intent: nextIntent, reviewId, reply: trimmedReply });
  };

  const draftReplyWithAi = (reviewId: string, existingDraft: string) => {
    setMutationError(null);
    submitMutation({ _intent: "draftReply", reviewId, existingDraft, replyTone });
  };

  const deleteReplyDraft = (reviewId: string) => {
    setMutationError(null);
    setOptimisticReply((prev) => ({ ...prev, [reviewId]: null }));
    setOptimisticRepliedAt((prev) => ({ ...prev, [reviewId]: null }));
    submitMutation({ _intent: "replyDelete", reviewId });
  };

  const deleteMedia = (mediaId: string) => {
    setMutationError(null);
    setOptimisticDeletedMediaIds((prev) => ({ ...prev, [mediaId]: true }));
    submitMutation({ _intent: "deleteMedia", mediaId });
  };

  const resetImportState = () => {
    setImportFileName(null);
    setImportFileContent(null);
    setImportPreviewRows([]);
    setImportFileError(null);
    if (importFileInputRef.current) {
      importFileInputRef.current.value = "";
    }
  };

  const closeImportModal = () => {
    setIsImportModalOpen(false);
    resetImportState();
  };

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    resetImportState();

    if (!file) {
      return;
    }

    setImportFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const preview = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

      if (!preview.data.length) {
        setImportFileError("The file has no data rows.");
        return;
      }

      setImportFileContent(text);
      setImportPreviewRows(preview.data.slice(0, 5));
    };
    reader.onerror = () => setImportFileError("Unable to read the file.");
    reader.readAsText(file);
  };

  const submitImportFile = (dryRun: boolean) => {
    if (!importFileContent) {
      return;
    }

    const formData = new FormData();
    formData.append("_intent", "import-csv");
    formData.append("source", importSource);
    formData.append("fileContent", importFileContent);
    formData.append("dryRun", dryRun ? "true" : "false");
    importFetcher.submit(formData, { method: "post" });
  };

  const applyBulkAction = (
    intent: "bulkApprove" | "bulkReject" | "bulkDelete" | "bulkArchive" | "bulkUnarchive",
  ) => {
    if (selectedIds.length === 0) {
      return;
    }

    // A reason is not something a merchant can skip by selecting several reviews at once.
    if (intent === "bulkReject") {
      setHidePrompt({ kind: "bulk" });
      return;
    }

    setMutationError(null);

    // Archiving and restoring do not change a review's status — they move it between the
    // working queue and the Archive, so it leaves whichever of the two is on screen. Treated
    // like a removal from this view, not like a moderation verdict.
    if (intent === "bulkDelete" || intent === "bulkArchive" || intent === "bulkUnarchive") {
      setOptimisticDeleted((prev) => {
        const next = { ...prev };
        selectedIds.forEach((id) => {
          next[id] = true;
        });
        return next;
      });
    } else {
      const status = intent === "bulkApprove" ? ReviewStatus.APPROVED : ReviewStatus.REJECTED;
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

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      // A plain <a href> would let App Bridge's link interception route this as an in-app
      // navigation instead of a real download, leaving the iframe blank on the raw CSV
      // response. Fetching the bytes and driving a synthetic, in-memory-object-URL anchor
      // keeps everything inside the iframe's own JS context, so the browser's native download
      // handling takes over regardless of App Bridge's click interception.
      const response = await fetch("/app/reviews/export");
      if (!response.ok) {
        throw new Error("Export failed.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "reviews-export.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch {
      setToastState({ content: "Export failed. Please try again.", error: true });
    } finally {
      setIsExporting(false);
    }
  };

  // The moderation queue's columns. Widths are declared for all five because the house table
  // is table-layout: fixed — the Review column takes what is left, which is the point: it is
  // the only column whose content varies in length, and it is the one a merchant reads.
  const reviewColumns: TableColumn<(typeof effectiveReviews)[number]>[] = [
    {
      key: "customer",
      header: "Customer",
      // A name needs a predictable minimum, not a share of whatever is left: at 16% of a
      // 616px split-view table this rendered "Amelia H…".
      width: "8rem",
      hideOnNarrow: true,
      render: (review) => (
        <span className={styles.customerCell}>
          <span className={styles.ellipsisCell}>{review.reviewerName}</span>
          {/* The verification indicator belongs next to the person, not buried in the review
              text — it is the single most important trust signal on the row. */}
          {review.verifiedPurchase ? (
            <span className={styles.metaVerified} title="Verified buyer">
              ✓ Verified
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "rating",
      header: "Rating",
      width: "5.5rem",
      render: (review) => (
        <div className={styles.rating} aria-label={`${review.rating} out of 5 stars`}>
          <StarRating value={review.rating} size={13} />
        </div>
      ),
    },
    {
      key: "review",
      header: "Review",
      render: (review) => {
        return (
          <>
            {review.title ? (
              <p className={styles.reviewTitle}>{review.title}</p>
            ) : (
              <p className={`${styles.reviewTitle} ${styles.reviewTitleEmpty}`}>No title provided</p>
            )}
            {/* A truncated preview of the body, which the narrow layout had no room for at
                all. The full text is one click away in the drawer. */}
            {review.content ? <p className={styles.reviewPreview}>{review.content}</p> : null}
            <p className={styles.reviewMetaLine}>
              {review.featured || review.media.length > 0 || review.reply ? (
                <span className={styles.metaSignals}>
                  {review.featured ? (
                    <span className={`${styles.metaSignal} ${styles.metaSignalHighlight}`} title="Featured">
                      <FeaturedIcon />
                    </span>
                  ) : null}
                  {review.media.length > 0 ? (
                    <span
                      className={styles.metaSignal}
                      title={`${review.media.length} photo${review.media.length === 1 ? "" : "s"}/video${review.media.length === 1 ? "" : "s"}`}
                    >
                      <MediaIcon />
                      {review.media.length}
                    </span>
                  ) : null}
                  {review.reply ? (
                    <span className={`${styles.metaSignal} ${styles.metaSignalSuccess}`} title="Replied">
                      <ReplyIcon />
                    </span>
                  ) : null}
                </span>
              ) : null}
            </p>
          </>
        );
      },
    },
    {
      key: "product",
      header: "Product",
      width: "16%",
      // Sheds before Customer: the detail panel open beside the table already names the
      // product, so this is the column the merchant least needs duplicated.
      hideOnCramped: true,
      render: (review) => (
        <span className={styles.ellipsisCell}>
          {review.productTitle ?? review.product?.name ?? "Unassigned product"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      // 6.5rem rather than 8rem: the badges are sentence case now, so "Approved" needs
      // noticeably less room than "APPROVED" did, and the space is worth more to Review.
      width: "6.5rem",
      render: (review) => <ReviewStatusBadge status={review.status} />,
    },
    {
      key: "date",
      header: "Date",
      width: "4.75rem",
      render: (review) => <span className={styles.dateCell}>{formatShortDate(review.createdAt)}</span>,
    },
  ];

  // Escape closes the detail drawer. Bound to the document rather than the drawer, because
  // focus is usually still on the table row the merchant arrowed to, not inside the drawer.
  useEffect(() => {
    if (!selectedReviewId) return;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSelectedReviewId(null);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedReviewId]);

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

  // "Is every row on this page ticked" now lives in <Table>, which renders the select-all
  // checkbox and computes it from the same selectedKeys it is handed — so there is one answer
  // instead of two that can disagree.

  // Same status-awareness as the single-review detail panel, extended to a selection: only
  // disable the bulk action when EVERY selected review already shares that exact status (a
  // genuinely no-op action for the whole selection) — a mixed selection (some pending, some
  // already approved) still gets a fully active Approve, since it's meaningful for the
  // pending ones. Reviews not present in the current page's effectiveReviews (e.g. a stale
  // selection after pagination) don't count toward either state.
  const selectedReviewRows = effectiveReviews.filter((review) => selectedIds.includes(review.id));
  const allSelectedApproved =
    selectedReviewRows.length > 0 && selectedReviewRows.every((review) => review.status === ReviewStatus.APPROVED);
  const allSelectedRejected =
    selectedReviewRows.length > 0 && selectedReviewRows.every((review) => review.status === ReviewStatus.REJECTED);

  return (
    <>
      <Container as="main">
      <div className={`${shellStyles.page} ${shellStyles.reveal}`}>
        <header className={`${shellStyles.header} ${styles.header}`}>
          <div className={shellStyles.headerContent}>
            <h1 className={shellStyles.title}>Reviews</h1>
            <p className={shellStyles.subtitle}>
              Moderate feedback with live workflow actions and bulk operations.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Popover
              active={moreActionsMenuOpen}
              onClose={() => setMoreActionsMenuOpen(false)}
              activator={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setMoreActionsMenuOpen((open) => !open)}
                  aria-label="More review actions"
                  aria-haspopup="menu"
                  aria-expanded={moreActionsMenuOpen}
                >
                  <span aria-hidden="true">&#8226;&#8226;&#8226;</span>
                  <span>More</span>
                </Button>
              }
            >
              <ActionList
                sections={[
                  {
                    items: [
                      {
                        content: "Import reviews",
                        onAction: () => {
                          setMoreActionsMenuOpen(false);
                          setIsImportModalOpen(true);
                        },
                      },
                      {
                        content: isExporting ? "Exporting…" : "Export reviews",
                        disabled: isExporting,
                        onAction: () => {
                          setMoreActionsMenuOpen(false);
                          void handleExport();
                        },
                      },
                    ],
                  },
                ]}
              />
            </Popover>
            <LinkButton to={`/app/reviews/new${location.search}`} variant="primary">
              New Review
            </LinkButton>
          </div>
        </header>

          {/* Real navigation between the two sections of this workspace — see
              WorkspaceTabs for why these are anchors and why there is no Customer Questions
              tab yet. */}
          <WorkspaceTabs
            tabs={REVIEW_WORKSPACE_TABS}
            currentPath={location.pathname}
            search={location.search}
          />


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
            <div className={styles.statusSegments} role="group" aria-label="Filter by status">
              {STATUS_FILTER_OPTIONS.map((option) => {
                // Selecting Archive clears any status filter, and selecting a status leaves
                // the Archive — the two views are mutually exclusive by construction.
                const isActive = option.archive ? isArchiveView : !isArchiveView && initialStatus === option.value;

                return (
                <button
                  key={option.archive ? "archive" : option.value || "all"}
                  type="button"
                  className={`${styles.statusSegment} ${isActive ? styles.statusSegmentActive : ""}`}
                  aria-pressed={isActive}
                  onClick={() =>
                    updateQuery(
                      option.archive
                        ? { archived: "1", status: undefined }
                        : { status: option.value || undefined, archived: undefined },
                    )
                  }
                >
                  {option.label}
                  {/* The count sits beside the label the way Judge.me's category tabs carry
                      theirs, so a merchant sees the size of the pending queue without
                      clicking into it. Rendered even at zero: here "0" is a fact the query
                      returned, not an unknown. */}
                  <span className={styles.statusSegmentCount}>
                    {formatCount(option.archive ? statusCounts.archived : statusCountFor(option.value))}
                  </span>
                </button>
                );
              })}
            </div>

            <Popover
              active={filtersOpen}
              onClose={() => setFiltersOpen(false)}
              activator={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setFiltersOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={filtersOpen}
                >
                  Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
                </Button>
              }
            >
              <div className={styles.filtersPanel}>
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

                <label className={styles.filterGroup}>
                  <span className={styles.filterLabel}>Sort</span>
                  <select
                    className={styles.filterSelect}
                    value={initialSort}
                    onChange={(event) => updateQuery({ sort: event.target.value === "helpful" ? "helpful" : undefined })}
                  >
                    <option value="newest">Newest</option>
                    <option value="helpful">Most Helpful</option>
                  </select>
                </label>

                {activeFilterCount > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      updateQuery({
                        rating: undefined,
                        product: undefined,
                        dateFrom: undefined,
                        dateTo: undefined,
                        verifiedPurchase: undefined,
                        sort: undefined,
                      })
                    }
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            </Popover>
          </div>
        </div>

        {mutationError ? <p className={styles.feedbackError}>{mutationError}</p> : null}
        {isLoading ? <p className={styles.feedbackMuted}>Refreshing review results...</p> : null}

        {/* No section title: the page is already headed "Reviews", and a second heading
            over the only table on it told the merchant nothing. Judge.me heads this screen
            once for the same reason. */}
        <Section>
          <div className={styles.resultsBar}>
            {selectedIds.length > 0 ? (
              <div className={styles.bulkBar}>
                <span className={styles.bulkCount}>{selectedIds.length} selected</span>
                <Button
                  type="button"
                  onClick={() => applyBulkAction("bulkApprove")}
                  disabled={isMutating || allSelectedApproved}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  onClick={() => applyBulkAction("bulkReject")}
                  disabled={isMutating || allSelectedRejected}
                >
                  Reject
                </Button>
                {isArchiveView ? (
                  <Button type="button" onClick={() => applyBulkAction("bulkUnarchive")} disabled={isMutating}>
                    Restore
                  </Button>
                ) : (
                  <Button type="button" onClick={() => applyBulkAction("bulkArchive")} disabled={isMutating}>
                    Archive
                  </Button>
                )}
                <Button type="button" onClick={() => applyBulkAction("bulkDelete")} disabled={isMutating}>
                  Delete
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSelectedIds([])} disabled={isMutating}>
                  Clear
                </Button>
              </div>
            ) : (
              <p className={styles.resultsCount}>
                {totalCount === 0
                  ? "No reviews yet."
                  : `Showing ${formatCount(rangeStart)}–${formatCount(rangeEnd)} of ${formatCount(totalCount)} review${totalCount === 1 ? "" : "s"}.`}
              </p>
            )}
          </div>

          {/* Single column while nothing is selected, so the table never gives up space to a
              panel that is not open. With a review selected the detail takes a real second
              column on a wide screen and reverts to a drawer below that — see
              .splitLayoutWithDetail for why. */}
          <div
            className={`${styles.splitLayout} ${selectedReview ? styles.splitLayoutWithDetail : ""}`}
          >
            {isLoading ? (
              <>
                <div className={styles.listColumn}>
                  <div className={styles.skeletonList} aria-hidden="true">
                    {Array.from({ length: 6 }, (_, index) => (
                      <div key={index} className={styles.skeletonRow} />
                    ))}
                  </div>
                </div>

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

              </>
            ) : (
              <>
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- delegates
                    ArrowUp/ArrowDown from the already-focusable table rows below; this
                    container itself is never a focus target. */}
                <div className={styles.listColumn} onKeyDown={onListKeyDown}>
                  <Table
                    rows={effectiveReviews}
                    columns={reviewColumns}
                    getRowKey={(review) => review.id}
                    ariaLabel="Reviews"
                    maxHeight="40rem"
                    activeRowKey={selectedReviewId}
                    onActivateRow={setSelectedReviewId}
                    selection={{
                      selectedKeys: selectedIds,
                      onToggleRow: toggleSelection,
                      onToggleAll: toggleSelectAllOnPage,
                      rowLabel: (review) => `Select review from ${review.reviewerName}`,
                      allLabel: "Select all reviews on this page",
                      disabled: isLoading || isMutating,
                    }}
                  />
                </div>

                {selectedReview ? (
                  <>
                    {/* Dismisses the drawer and dims the table behind it. A real button rather
                        than a div with an onClick, so it is keyboard-reachable; its label is
                        what a screen reader announces for the click target. */}
                    <button
                      type="button"
                      className={styles.detailScrim}
                      aria-label="Close review details"
                      onClick={() => setSelectedReviewId(null)}
                    />
                    {/* key={selectedReview.id} forces a real remount on every selection change
                        — the only way the drawer's CSS mount animation replays per-review
                        instead of only once for the drawer's own lifetime. */}
                    <aside
                      key={selectedReview.id}
                      className={styles.detailPanel}
                      aria-label="Review details"
                      role="dialog"
                      aria-modal="false"
                    >
                      {/* The drawer's close control, at every width. It used to be mobile-only,
                          when the panel was a permanent column that never needed dismissing on
                          desktop. Escape closes it too — see the key handler on the page. */}
                      <button
                        type="button"
                        className={styles.mobileBackButton}
                        onClick={() => setSelectedReviewId(null)}
                      >
                        &larr; Close
                      </button>
                    <div className={styles.detailHeader}>
                      <div className={styles.detailStatusRow}>
                        <ReviewStatusBadge status={selectedReview.status} />
                        {selectedReview.moderationStatus === "auto_approved" ? (
                          <span className={styles.autoApprovedBadge}>Auto Approved</span>
                        ) : null}
                        {selectedReview.verifiedPurchase ? <VerifiedBadge /> : null}
                        {selectedReview.externalId ? <ImportedBadge /> : null}
                        {selectedReview.featured ? <FeaturedBadge /> : null}
                        <RewardBadge reward={selectedReview.reward} />
                      </div>
                      <h2 className={selectedReview.title ? styles.detailTitle : `${styles.detailTitle} ${styles.detailTitleEmpty}`}>
                        {selectedReview.title ?? "No title provided"}
                      </h2>
                      <div className={styles.ratingLarge} aria-label={`${selectedReview.rating} out of 5 stars`}>
                        <StarRating value={selectedReview.rating} size={15} />
                      </div>
                    </div>

                    <div className={styles.detailDivider} />

                    <div className={styles.detailBody}>
                      <div className={styles.detailSection}>
                        <p className={styles.detailLabel}>Review</p>
                        <p className={styles.reviewContentText}>{selectedReview.content}</p>
                      </div>

                      {aiSummaries[selectedReview.productId] ? (
                        <div className={styles.aiSummaryCallout}>
                          <p className={styles.aiSummaryLabel}>AI Summary</p>
                          <p className={styles.aiSummaryText}>{aiSummaries[selectedReview.productId].summary}</p>
                          {aiSummaries[selectedReview.productId].recommendation ? (
                            <p className={styles.aiSummaryRecommendation}>
                              {aiSummaries[selectedReview.productId].recommendation}
                            </p>
                          ) : null}
                          <RemixLink
                            to={`/app/products/${selectedReview.productId}`}
                            className={styles.aiSummaryLink}
                          >
                            View full analysis &rarr;
                          </RemixLink>
                        </div>
                      ) : null}

                      <div className={styles.detailMeta}>
                        <div className={styles.detailMetaRow}>
                          <span className={styles.detailMetaLabel}>Customer</span>
                          <span className={styles.detailMetaValue}>{selectedReview.reviewerName}</span>
                        </div>
                        {selectedReview.reviewerEmail ? (
                          <div className={styles.detailMetaRow}>
                            <span className={styles.detailMetaLabel}>Email</span>
                            <span className={styles.detailMetaValue}>{selectedReview.reviewerEmail}</span>
                          </div>
                        ) : null}
                        {selectedReview.reviewerLocation ? (
                          <div className={styles.detailMetaRow}>
                            <span className={styles.detailMetaLabel}>Location</span>
                            <span className={styles.detailMetaValue}>{selectedReview.reviewerLocation}</span>
                          </div>
                        ) : null}
                        <div className={styles.detailMetaRow}>
                          <span className={styles.detailMetaLabel}>Product</span>
                          <span className={styles.detailMetaValue}>
                            {selectedReview.productTitle ?? selectedReview.product?.name ?? "Unassigned product"}
                          </span>
                        </div>
                        <div className={styles.detailMetaRow}>
                          <span className={styles.detailMetaLabel}>Created</span>
                          <span className={styles.detailMetaValue}>{formatLongDate(selectedReview.createdAt)}</span>
                        </div>
                        {selectedReview.moderationReason ? (
                          <div className={styles.detailMetaRow}>
                            <span className={styles.detailMetaLabel}>Moderation</span>
                            <span className={styles.detailMetaValue}>{selectedReview.moderationReason}</span>
                          </div>
                        ) : null}
                        {/* Why a person hid it, which is a different fact from the
                            "Moderation" row above — that one records how the automated rules
                            first classified it. */}
                        {selectedReview.hiddenReason ? (
                          <div className={styles.detailMetaRow}>
                            <span className={styles.detailMetaLabel}>Hidden</span>
                            <span className={styles.detailMetaValue}>
                              {reviewHideReasonLabel(selectedReview.hiddenReason) ?? selectedReview.hiddenReason}
                              {selectedReview.hiddenAt ? ` · ${formatShortDate(selectedReview.hiddenAt)}` : ""}
                            </span>
                          </div>
                        ) : null}
                        {selectedReview.importSource ? (
                          <div className={styles.detailMetaRow}>
                            <span className={styles.detailMetaLabel}>Source</span>
                            <span className={styles.detailMetaValue}>
                              {IMPORT_SOURCES.find((s) => s.value === selectedReview.importSource)?.label ??
                                selectedReview.importSource}
                              {selectedReview.sourceVerified === null
                                ? " · verification not claimed by source"
                                : selectedReview.sourceVerified
                                  ? " · source claimed verified purchase (not IMAGYN-verified)"
                                  : " · source did not claim a verified purchase"}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      <div className={styles.detailSection}>
                        <p className={styles.detailLabel}>Photos &amp; Video</p>
                        {(() => {
                          const visibleMedia = selectedReview.media.filter(
                            (item) => !optimisticDeletedMediaIds[item.id],
                          );

                          if (visibleMedia.length === 0) {
                            return <p className={styles.detailPlaceholder}>No photos or video have been uploaded for this review.</p>;
                          }

                          const shownMedia = showAllPhotos ? visibleMedia : visibleMedia.slice(0, PHOTO_PREVIEW_COUNT);
                          const hiddenCount = visibleMedia.length - shownMedia.length;

                          return (
                            <div className={styles.photoStrip}>
                              {shownMedia.map((item) =>
                                item.type === "VIDEO" ? (
                                  // 48x48 is too small for usable native <video> controls, so
                                  // the thumbnail is a muted, non-interactive preview frame
                                  // (same play-icon-overlay treatment as the storefront widget)
                                  // — clicking it opens the real video in a new tab, where the
                                  // browser's own player takes over. Mirrors exactly how a
                                  // photo thumbnail already opens its full-size image.
                                  <div key={item.id} className={styles.photoThumb}>
                                    <a href={item.url} target="_blank" rel="noreferrer" aria-label="Play video">
                                      <video className={styles.photoThumbImage} src={item.url} muted preload="metadata" />
                                      <span className={styles.photoThumbPlay} aria-hidden="true">
                                        ▶
                                      </span>
                                    </a>
                                    <button
                                      type="button"
                                      className={styles.photoDeleteButton}
                                      onClick={() => deleteMedia(item.id)}
                                      disabled={isMutating}
                                      aria-label="Delete video"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ) : (
                                  <div key={item.id} className={styles.photoThumb}>
                                    <a href={item.url} target="_blank" rel="noreferrer" aria-label="View full size">
                                      <img
                                        className={styles.photoThumbImage}
                                        src={item.thumbnailUrl ?? item.url}
                                        alt="Review attachment"
                                        loading="lazy"
                                      />
                                    </a>
                                    <button
                                      type="button"
                                      className={styles.photoDeleteButton}
                                      onClick={() => deleteMedia(item.id)}
                                      disabled={isMutating}
                                      aria-label="Delete photo"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ),
                              )}
                              {hiddenCount > 0 ? (
                                <button
                                  type="button"
                                  className={styles.photoMoreButton}
                                  onClick={() => setShowAllPhotos(true)}
                                  aria-label={`Show ${hiddenCount} more photo${hiddenCount === 1 ? "" : "s"}`}
                                >
                                  +{hiddenCount}
                                </button>
                              ) : null}
                            </div>
                          );
                        })()}
                      </div>

                      <div className={styles.detailSection}>
                        <p className={styles.detailLabel}>Merchant Reply</p>
                        {selectedReview.reply && !isReplyEditing ? (
                          <>
                            <div className={styles.replyDisplay}>{selectedReview.reply}</div>
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
                              <Button type="button" onClick={() => deleteReplyDraft(selectedReview.id)} disabled={isReplySaving}>
                                Delete
                              </Button>
                            </div>
                          </>
                        ) : !isReplyEditing ? (
                          <div className={styles.replyPrompt}>
                            <p className={styles.detailPlaceholder}>No reply yet.</p>
                            <div className={styles.replyActions}>
                              <Button type="button" variant="ghost" onClick={() => setIsReplyEditing(true)}>
                                Reply
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => draftReplyWithAi(selectedReview.id, "")}
                                disabled={isDraftingReply}
                              >
                                {isDraftingReply ? "Drafting…" : "Draft with AI"}
                              </Button>
                              {/* The voice, next to the button that uses it. A <select>
                                  rather than three buttons: it is a single-choice setting
                                  sitting in a row that is already dense with actions, and
                                  three more buttons there would compete with Save. */}
                              <label className={styles.replyToneField}>
                                <span className={styles.replyToneLabel}>Voice</span>
                                <select
                                  className={styles.replyToneSelect}
                                  value={replyTone}
                                  onChange={(event) =>
                                    setReplyTone(
                                      isAiReplyTone(event.target.value) ? event.target.value : DEFAULT_AI_REPLY_TONE,
                                    )
                                  }
                                  disabled={isDraftingReply}
                                  title={AI_REPLY_TONE_LABELS[replyTone].hint}
                                >
                                  {AI_REPLY_TONES.map((tone) => (
                                    <option key={tone} value={tone}>
                                      {AI_REPLY_TONE_LABELS[tone].label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          </div>
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
                                disabled={isReplySaving || isDraftingReply}
                              />
                            </div>
                            <div className={styles.replyActions}>
                              <Button
                                type="button"
                                onClick={() => applyReply(selectedReview.id, replyDraft)}
                                disabled={isReplySaving || isDraftingReply || replyDraft.trim().length === 0}
                              >
                                Save
                              </Button>
                              {/* Always a suggestion the merchant reviews before Save ever fires — see
                                  aiReplyDraft.server.ts's own comment on why this never auto-publishes. */}
                              <Button
                                type="button"
                                onClick={() => draftReplyWithAi(selectedReview.id, replyDraft)}
                                disabled={isReplySaving || isDraftingReply}
                              >
                                {isDraftingReply ? "Drafting…" : replyDraft.trim() ? "Improve with AI" : "Draft with AI"}
                              </Button>
                              {/* The voice, next to the button that uses it. A <select>
                                  rather than three buttons: it is a single-choice setting
                                  sitting in a row that is already dense with actions, and
                                  three more buttons there would compete with Save. */}
                              <label className={styles.replyToneField}>
                                <span className={styles.replyToneLabel}>Voice</span>
                                <select
                                  className={styles.replyToneSelect}
                                  value={replyTone}
                                  onChange={(event) =>
                                    setReplyTone(
                                      isAiReplyTone(event.target.value) ? event.target.value : DEFAULT_AI_REPLY_TONE,
                                    )
                                  }
                                  disabled={isReplySaving || isDraftingReply}
                                  title={AI_REPLY_TONE_LABELS[replyTone].hint}
                                >
                                  {AI_REPLY_TONES.map((tone) => (
                                    <option key={tone} value={tone}>
                                      {AI_REPLY_TONE_LABELS[tone].label}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <Button
                                type="button"
                                onClick={() => {
                                  setReplyDraft(selectedReview.reply ?? "");
                                  setIsReplyEditing(false);
                                }}
                                disabled={isReplySaving || isDraftingReply}
                              >
                                Cancel
                              </Button>
                              {selectedReview.reply ? (
                                <Button
                                  type="button"
                                  onClick={() => deleteReplyDraft(selectedReview.id)}
                                  disabled={isReplySaving || isDraftingReply}
                                >
                                  Delete
                                </Button>
                              ) : null}
                            </div>
                          </>
                        )}
                      </div>

                      <div className={styles.detailFooterRow}>
                        <span className={styles.detailFooterStat}>{selectedReview.helpfulCount} helpful</span>
                        <span className={styles.detailFooterStat}>{selectedReview.notHelpfulCount} not helpful</span>
                      </div>
                    </div>

                    <div className={styles.detailDivider} />

                    <div className={styles.detailActions}>
                      <div className={styles.moderationButtons}>
                        {/* Status-aware: a review already in a given state doesn't get an
                            active action for that same state again — Approve only appears
                            when the review isn't already Approved, Reject only when it isn't
                            already Rejected. The opposite action always remains available
                            (Approved -> Reject, Rejected -> Approve/restore) since
                            review.server.ts's approveReview/rejectReview are plain,
                            unconditional status setters with no state-machine restriction —
                            this is a UI truthfulness fix, not a new backend capability. */}
                        {selectedReview.status !== ReviewStatus.APPROVED ? (
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() => applySingleStatus(selectedReview.id, ReviewStatus.APPROVED)}
                            disabled={isMutating}
                          >
                            Approve
                          </Button>
                        ) : null}
                        {selectedReview.status !== ReviewStatus.REJECTED ? (
                          <Button
                            type="button"
                            onClick={() => applySingleStatus(selectedReview.id, ReviewStatus.REJECTED)}
                            disabled={isMutating}
                          >
                            Reject
                          </Button>
                        ) : null}
                        {/* Archiving is filing, not moderation, so it sits beside the verdict
                            buttons rather than among them — and in the Archive view the only
                            thing this control can usefully do is undo itself. */}
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            submitMutation({
                              _intent: selectedReview.archivedAt ? "unarchive" : "archive",
                              reviewId: selectedReview.id,
                            })
                          }
                          disabled={isMutating}
                        >
                          {selectedReview.archivedAt ? "Restore" : "Archive"}
                        </Button>
                      </div>
                      <Popover
                        active={actionsMenuOpen}
                        onClose={() => setActionsMenuOpen(false)}
                        activator={
                          <Button
                            type="button"
                            variant="secondary"
                            className={styles.actionsMenuButton}
                            onClick={() => setActionsMenuOpen((open) => !open)}
                            disabled={isMutating}
                            aria-label="Review actions"
                            aria-haspopup="menu"
                            aria-expanded={actionsMenuOpen}
                          >
                            <span aria-hidden="true">&#8226;&#8226;&#8226;</span>
                            <span>Actions</span>
                          </Button>
                        }
                      >
                        <ActionList
                          sections={[
                            {
                              items: [
                                {
                                  content: "Edit",
                                  url: `/app/reviews/${selectedReview.id}/edit${location.search}`,
                                },
                              ],
                            },
                            {
                              items: [
                                {
                                  content: "Delete",
                                  destructive: true,
                                  onAction: () => {
                                    setActionsMenuOpen(false);
                                    applySingleDelete(selectedReview.id);
                                  },
                                },
                              ],
                            },
                          ]}
                        />
                      </Popover>
                    </div>
                    </aside>
                  </>
                ) : null}
              </>
            )}
          </div>

          <div className={styles.pagination}>
            <Button
              type="button"
              variant="secondary"
              onClick={goToPreviousPage}
              disabled={cursorHistory.length === 0 || isLoading || isMutating}
            >
              Previous
            </Button>
            <p className={styles.pageInfo}>
              Page {formatCount(currentPage)} of {formatCount(totalPages)}
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={goToNextPage}
              disabled={!hasMore || !nextCursor || isLoading || isMutating}
            >
              Next
            </Button>
          </div>
        </Section>
      </div>
      </Container>

      {/* Hiding a review records why. A fixed list rather than free text, because this is an
          accountability record: it has to be aggregatable and auditable, and "spam lol" is
          neither. See REVIEW_HIDE_REASONS. */}
      <Modal
        open={hidePrompt !== null}
        onClose={() => setHidePrompt(null)}
        title={
          hidePrompt?.kind === "bulk"
            ? `Hide ${formatCount(selectedIds.length)} review${selectedIds.length === 1 ? "" : "s"}`
            : "Hide review"
        }
        primaryAction={{ content: "Hide review", onAction: confirmHide, destructive: true }}
        secondaryActions={[{ content: "Cancel", onAction: () => setHidePrompt(null) }]}
      >
        <Modal.Section>
          <div className={styles.fieldGroup}>
            <label className={styles.filterLabel} htmlFor="hide-reason">
              Reason for hiding
            </label>
            <select
              id="hide-reason"
              className={styles.filterSelect}
              value={hideReason}
              onChange={(event) => setHideReason(event.target.value as ReviewHideReasonId)}
            >
              {REVIEW_HIDE_REASONS.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.label}
                </option>
              ))}
            </select>
            <p className={styles.feedbackMuted}>
              Recorded with the review for your own records. It is never shown to customers or on
              your storefront.
            </p>
          </div>
        </Modal.Section>
      </Modal>

      <Modal
        open={isImportModalOpen}
        onClose={closeImportModal}
        title="Import reviews"
        primaryAction={{
          content: isImporting ? "Importing…" : "Import",
          onAction: () => submitImportFile(false),
          disabled: !importFileContent || isImporting,
          loading: isImporting,
        }}
        secondaryActions={[
          {
            content: "Dry run",
            onAction: () => submitImportFile(true),
            disabled: !importFileContent || isImporting,
          },
          { content: "Close", onAction: closeImportModal },
        ]}
      >
        <Modal.Section>
          <div className={styles.importSourceRow}>
            <span className={styles.filterLabel}>Import from</span>
            <select
              className={styles.filterSelect}
              value={importSource}
              onChange={(event) => setImportSource(event.target.value as ImportSource)}
              disabled={isImporting}
            >
              {IMPORT_SOURCES.map((source) => (
                <option key={source.value} value={source.value} disabled={!source.available}>
                  {source.label}
                  {source.available ? "" : " (coming soon)"}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.importFileRow}>
            <input
              ref={importFileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportFileChange}
              disabled={isImporting}
            />
            {importFileName ? <span className={styles.filterLabel}>{importFileName}</span> : null}
          </div>

          <p className={styles.detailSubvalue}>
            &ldquo;Dry run&rdquo; checks product matching and duplicates against your live catalog without creating
            any reviews — use it to see exactly what a real import would do first.
          </p>

          {importFileError ? <Banner tone="critical">{importFileError}</Banner> : null}

          {importPreviewRows.length > 0 ? (
            <div className={styles.importPreview}>
              <p className={styles.detailLabel}>Preview — first {importPreviewRows.length} rows</p>
              <div className={styles.importPreviewTableWrap}>
                <table className={styles.importPreviewTable}>
                  <thead>
                    <tr>
                      {previewHeaders.map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreviewRows.map((row, index) => (
                      <tr key={index}>
                        {previewHeaders.map((header) => (
                          <td key={header}>{row[header]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {importFetcher.data?.importResult ? (
            <div className={styles.importResult}>
              <Banner tone={importFetcher.data.ok ? "success" : "critical"}>
                {importFetcher.data.ok ? importFetcher.data.message : importFetcher.data.error}
              </Banner>
              {importFetcher.data.importResult.dryRun ? (
                <Banner tone="info">No reviews were created — this was a dry run.</Banner>
              ) : null}
              <p className={styles.detailSubvalue}>
                {importFetcher.data.importResult.totalRows} total rows ·{" "}
                {importFetcher.data.importResult.matchedRows} matched ·{" "}
                {importFetcher.data.importResult.unmatchedRows} unmatched ·{" "}
                {importFetcher.data.importResult.duplicateRows} duplicate{importFetcher.data.importResult.duplicateRows === 1 ? "" : "s"} ·{" "}
                {importFetcher.data.importResult.invalidRows} invalid ·{" "}
                {importFetcher.data.importResult.heldForModeration} held for moderation ·{" "}
                {importFetcher.data.importResult.dryRun ? "would import " : "imported "}
                {importFetcher.data.importResult.expectedImportedCount}
              </p>

              {importFetcher.data.importResult.missingProducts.length > 0 ? (
                <>
                  <p className={styles.detailLabel}>Missing products</p>
                  <ul className={styles.importErrorList}>
                    {importFetcher.data.importResult.missingProducts.map((issue, index) => (
                      <li key={index}>
                        Row {issue.row}
                        {issue.productTitle ? ` — "${issue.productTitle}"` : ""}
                        {issue.productId ? ` (product ID: ${issue.productId})` : ""}
                        {issue.productHandle ? ` (handle: ${issue.productHandle})` : ""}
                        {issue.productUrl ? ` (URL: ${issue.productUrl})` : ""}
                        : {issue.reason}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {importFetcher.data.importResult.errors.length > 0 ? (
                <>
                  <p className={styles.detailLabel}>Errors</p>
                  <ul className={styles.importErrorList}>
                    {importFetcher.data.importResult.errors.map((rowError, index) => (
                      <li key={index}>
                        {rowError.row > 0 ? `Row ${rowError.row}: ` : ""}
                        {rowError.reason}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {importFetcher.data.importResult.warnings.length > 0 ? (
                <>
                  <p className={styles.detailLabel}>Warnings</p>
                  <ul className={styles.importErrorList}>
                    {importFetcher.data.importResult.warnings.map((warning, index) => (
                      <li key={index}>
                        Row {warning.row}: {warning.reason}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </Modal.Section>
      </Modal>

      {/* Frame exists solely to satisfy Toast's required-ancestor context — see
          .toastFrame in app.reviews.module.css for why it needs a layout override. */}
      <div className={styles.toastFrame}>
        <Frame>
          {toastState ? (
            <Toast content={toastState.content} error={toastState.error} onDismiss={() => setToastState(null)} />
          ) : null}
        </Frame>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
