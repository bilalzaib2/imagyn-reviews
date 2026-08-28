import { useEffect, useMemo, useRef, useState } from "react";
import {
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
import {
  Badge,
  BlockStack,
  Card,
  DataTable,
  Frame,
  SkeletonBodyText,
  SkeletonDisplayText,
  Toast,
} from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { ProgressBar } from "../components/ui/ProgressBar";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore, getProductSyncState, startProductSync, type ProductSyncState } from "../services/store.server";
import { getProductsPage } from "../services/product.server";
import { isProductSyncInProgress, runProductSync } from "../services/productSync.server";
import {
  historyForNextPage,
  historyForPreviousPage,
  pageNumberFor,
  parseCursorHistory,
  rangeFor,
  serializeCursorHistory,
  totalPagesFor,
} from "../services/cursorPagination.shared";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.products.module.css";

// Same page size as the Reviews list — see cursorPagination.shared.ts for the pagination
// architecture this reuses wholesale.
const PRODUCTS_PAGE_SIZE = 25;

type ProductListItem = Awaited<ReturnType<typeof getProductsPage>>["products"][number];

type ActionData = {
  ok: boolean;
  started?: boolean;
  error?: string;
};

type LoaderData = {
  products: ProductListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  search: string;
  syncState: ProductSyncState | null;
  error: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || undefined;
  const cursor = url.searchParams.get("cursor") || undefined;

  try {
    const store = await getOrCreateStore(session.shop);
    const [page, syncState] = await Promise.all([
      getProductsPage(store.id, { search, cursor, limit: PRODUCTS_PAGE_SIZE }),
      getProductSyncState(store.id),
    ]);

    return {
      products: page.products,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      totalCount: page.totalCount,
      search: search ?? "",
      syncState,
      error: null,
    };
  } catch (error) {
    return {
      products: [],
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
      search: search ?? "",
      syncState: null,
      error: error instanceof Error ? error.message : "Unable to load products.",
    };
  }
};

// Starts the sync and returns immediately — the actual work (paging through the entire
// Shopify catalog) happens in runProductSync, deliberately not awaited here. This process
// (react-router-serve) stays alive on Railway between requests, so the fire-and-forget promise
// keeps running after this response is sent; the client learns progress by polling
// app.products.sync-status.tsx, not by this request staying open. See productSync.server.ts.
export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);

  try {
    const store = await getOrCreateStore(session.shop);
    const currentState = await getProductSyncState(store.id);

    if (isProductSyncInProgress(currentState)) {
      return { ok: false, error: "A product sync is already in progress." };
    }

    await startProductSync(store.id);

    // runProductSync always records its own success/failure state before returning — this
    // catch only guards against something throwing before it even gets that far.
    runProductSync(session.shop, store.id).catch((error) => {
      console.error("[productSync] Unhandled error starting product sync:", error);
    });

    return { ok: true, started: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to start product sync.",
    };
  }
};

const formatStatusLabel = (status: string | null) => {
  if (!status) {
    return "Unknown";
  }

  const normalized = status.toLowerCase();
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
};

const statusToneFor = (status: string | null): "success" | "info" | "attention" => {
  const normalized = status?.toLowerCase() ?? "";

  if (normalized === "active") {
    return "success";
  }

  if (normalized === "archived") {
    return "attention";
  }

  return "info";
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

const formatCount = (value: number) => new Intl.NumberFormat("en").format(value);

const POLL_INTERVAL_MS = 1500;

export default function ProductsPage() {
  const {
    products,
    nextCursor,
    hasMore,
    totalCount,
    search: initialSearch,
    syncState: initialSyncState,
    error,
  } = useLoaderData<typeof loader>();
  const actionFetcher = useFetcher<ActionData>();
  const statusFetcher = useFetcher<ProductSyncState>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const location = useLocation();

  const isLoading = navigation.state !== "idle";

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(initialSearch);

  // Same cursor-stack pagination as the Reviews page — see cursorPagination.shared.ts. Page
  // number is derived purely from the URL's `history` stack, so it survives direct navigation/
  // reload and supports a Previous that reliably works more than one hop back.
  const cursorHistory = useMemo(() => parseCursorHistory(searchParams.get("history")), [searchParams]);
  const currentPage = pageNumberFor(cursorHistory);
  const totalPages = totalPagesFor(totalCount, PRODUCTS_PAGE_SIZE);
  const { start: rangeStart, end: rangeEnd } = rangeFor(currentPage, PRODUCTS_PAGE_SIZE, totalCount, products.length);

  const [syncState, setSyncState] = useState<ProductSyncState | null>(initialSyncState);
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);
  const prevStatusRef = useRef<ProductSyncState["status"] | null>(initialSyncState?.status ?? null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSyncing = syncState?.status === "running";
  const attempted = (syncState?.synced ?? 0) + (syncState?.failed ?? 0);
  const percent =
    syncState?.total && syncState.total > 0 ? Math.min(100, Math.round((attempted / syncState.total) * 100)) : null;

  useEffect(() => {
    setSearchInput(initialSearch);
  }, [initialSearch]);

  // `searchParams` deliberately isn't a dependency here — clicking Next/Previous also changes
  // searchParams (cursor/history), and if this effect re-ran on that change too, its debounce
  // timer would fire ~280ms later and unconditionally strip the cursor/history it just set,
  // snapping the merchant straight back to page 1. This should only ever fire in response to
  // the merchant actually typing in the search box. A ref keeps it reading the latest
  // searchParams when it does fire, without making that value a re-trigger source. Same
  // pattern as app.reviews.tsx's own search field — see its comment for the full incident.
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  // `setSearchParams` also isn't a dependency, for the same reason `statusFetcher` is
  // omitted from the polling effect below: React Router doesn't guarantee this function's
  // identity is stable across re-renders, and this page re-renders more than most after any
  // navigation (sync-status polling, statusFetcher, revalidator all settling) — enough for a
  // fresh `setSearchParams` reference to still re-trigger this effect right after Next/
  // Previous, reintroducing the exact revert this effect exists to prevent. Confirmed live:
  // Next produced two extra reverting navigations (~280ms apart) even with searchParams
  // already excluded above, traced to this effect's own delete("cursor")/delete("history")
  // calls. Whichever closure over setSearchParams runs still dispatches to the same
  // underlying router, so omitting it here is safe.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Picks up the latest polled snapshot from the status fetcher into local state, so the rest
  // of this component only ever reads one `syncState`, whether it came from the initial page
  // load or a poll tick.
  useEffect(() => {
    if (statusFetcher.data) {
      setSyncState(statusFetcher.data);
    }
  }, [statusFetcher.data]);

  // Polls app.products.sync-status.tsx every ~1.5s while a sync is running — a dedicated
  // lightweight route rather than re-running this page's own loader, so polling doesn't
  // re-fetch and re-serialize the current product page on every tick.
  useEffect(() => {
    if (!isSyncing) {
      return;
    }

    const poll = () => {
      if (statusFetcher.state === "idle") {
        statusFetcher.load("/app/products/sync-status");
      }
      pollTimeoutRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    };

    pollTimeoutRef.current = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSyncing]);

  // Fires exactly once per sync, on the running -> completed/failed transition — refreshes the
  // currently-viewed product page (a new full-catalog sync can add/update far more rows than
  // the initial page load knew about) and shows the completion toast required by spec:
  // "Successfully synced X products."
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const nextStatus = syncState?.status ?? null;

    if (prevStatus === "running" && nextStatus === "completed") {
      setToastState({ content: `Successfully synced ${formatCount(syncState?.synced ?? 0)} products.` });
      revalidator.revalidate();
    } else if (prevStatus === "running" && nextStatus === "failed") {
      setToastState({ content: syncState?.error || "Product sync failed.", error: true });
      revalidator.revalidate();
    }

    prevStatusRef.current = nextStatus;
  }, [syncState, revalidator]);

  useEffect(() => {
    if (!actionFetcher.data) {
      return;
    }

    if (!actionFetcher.data.ok) {
      setToastState({ content: actionFetcher.data.error || "Unable to start product sync.", error: true });
      return;
    }

    // Optimistic local state so the progress bar appears immediately rather than waiting for
    // the first poll tick — the next poll (≤1.5s later) overwrites this with the server's own
    // numbers regardless.
    setSyncState({
      status: "running",
      total: null,
      synced: 0,
      failed: 0,
      startedAt: new Date(),
      finishedAt: null,
      error: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFetcher.data]);

  const handleSync = () => {
    actionFetcher.submit({ _intent: "sync-products" }, { method: "post" });
  };

  const goToPreviousPage = () => {
    if (cursorHistory.length === 0) return;
    const next = new URLSearchParams(searchParams);
    const newHistory = historyForPreviousPage(cursorHistory);
    if (newHistory.length > 0) {
      next.set("cursor", newHistory[newHistory.length - 1]);
      next.set("history", serializeCursorHistory(newHistory));
    } else {
      next.delete("cursor");
      next.delete("history");
    }
    setSearchParams(next);
  };

  const goToNextPage = () => {
    if (!nextCursor) return;
    const next = new URLSearchParams(searchParams);
    next.set("cursor", nextCursor);
    next.set("history", serializeCursorHistory(historyForNextPage(cursorHistory, nextCursor)));
    setSearchParams(next);
  };

  // A plain react-router <Link> here never navigates: its onClick always calls
  // event.preventDefault() and performs its own client-side transition directly, bypassing
  // the anchor's native click entirely. That's the problem — @shopify/shopify-app-react-
  // router's own AppProvider (see AppProvider.mjs) mounts the real App Bridge script and
  // wires up navigation through it: App Bridge intercepts the native click on an <a href>,
  // then dispatches a "shopify:navigate" DOM event carrying that href, which AppProvider's
  // own listener turns into the actual navigate() call. A `navigate()` called directly from
  // a custom onClick (confirmed live, with or without preventDefault) never updates the URL
  // — App Bridge owns navigation in this embedded context, so the fix is a genuine `<a href>`
  // with no competing onClick, letting App Bridge's own click interception do its job
  // unimpeded, exactly like every other embedded-app link in this codebase already relies on
  // implicitly (this cell was the only place rendering a react-router <Link> instead).
  const rows = products.map((product: ProductListItem) => [
    <a
      key={`${product.id}-image`}
      href={`/app/products/${product.id}${location.search}`}
      className={styles.productCell}
    >
      {product.featuredImage ? (
        <img className={styles.productImage} src={product.featuredImage} alt={product.name} loading="lazy" />
      ) : (
        <div className={styles.productImagePlaceholder} aria-hidden="true" />
      )}
      <div className={styles.productMeta}>
        <span className={styles.productName}>{product.name}</span>
        {product.vendor ? <span className={styles.productVendor}>{product.vendor}</span> : null}
      </div>
    </a>,
    product.handle ?? "-",
    product.productType || "-",
    <Badge key={`${product.id}-status`} tone={statusToneFor(product.status)}>
      {formatStatusLabel(product.status)}
    </Badge>,
    formatDate(product.updatedAt),
  ]);

  return (
    <>
      <Container as="main">
        <div className={shellStyles.page}>
          <header className={`${shellStyles.header} ${styles.header}`}>
            <div className={shellStyles.headerContent}>
              <p className={shellStyles.eyebrow}>Imagyn Reviews</p>
              <h1 className={shellStyles.title}>Products</h1>
              <p className={shellStyles.subtitle}>
                Sync your entire Shopify catalog to connect products with reviews and widgets.
              </p>
            </div>
            <div className={styles.headerActions}>
              <Button type="button" onClick={handleSync} disabled={isSyncing || actionFetcher.state !== "idle"}>
                {isSyncing ? "Syncing…" : "Sync Products"}
              </Button>
            </div>
          </header>

          {isSyncing ? (
            <div className={styles.syncPanel}>
              <ProgressBar
                percent={percent}
                label={
                  syncState?.total
                    ? `Syncing products… ${formatCount(attempted)} / ${formatCount(syncState.total)}${percent !== null ? ` (${percent}%)` : ""}`
                    : `Syncing products… ${formatCount(syncState?.synced ?? 0)} synced`
                }
              />
            </div>
          ) : syncState?.status === "completed" ? (
            <div className={styles.syncSummary}>
              <p className={styles.syncSummaryText}>
                {syncState.total !== null ? `${formatCount(syncState.total)} Shopify products · ` : ""}
                {formatCount(syncState.synced)} synced
                {syncState.failed > 0 ? ` · ${formatCount(syncState.failed)} failed` : ""}
              </p>
            </div>
          ) : syncState?.status === "failed" ? (
            <div className={styles.syncSummary}>
              <p className={styles.syncSummaryTextError}>
                Product sync failed: {syncState.error || "Unknown error."}
              </p>
            </div>
          ) : null}

          {error ? (
            <div className={styles.errorState} role="alert">
              <h2 className={styles.errorStateTitle}>Unable to load products</h2>
              <p className={styles.errorStateText}>{error}</p>
            </div>
          ) : null}

          <label className={styles.searchField}>
            <input
              className={styles.searchInput}
              type="search"
              placeholder="Search products by name, handle, or vendor"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search products"
            />
          </label>

          <p className={styles.resultsSummary}>
            {totalCount === 0
              ? "No products found."
              : `Showing ${formatCount(rangeStart)}–${formatCount(rangeEnd)} of ${formatCount(totalCount)} product${totalCount === 1 ? "" : "s"}.`}
          </p>

          <div className={styles.tableCard}>
            <Card>
              {isLoading ? (
                <div className={styles.skeletonTable}>
                  <SkeletonDisplayText size="small" />
                  <SkeletonBodyText lines={8} />
                </div>
              ) : products.length === 0 ? (
                <div className={styles.emptyState}>
                  <h2 className={styles.emptyStateTitle}>
                    {initialSearch ? "No products match your search" : "No products synced yet"}
                  </h2>
                  <p className={styles.emptyStateText}>
                    {initialSearch
                      ? "Try a different search term, or clear the search to see your full catalog."
                      : "Sync your Shopify catalog to bring products into Imagyn Reviews."}
                  </p>
                  {!initialSearch ? (
                    <Button type="button" onClick={handleSync} disabled={isSyncing || actionFetcher.state !== "idle"}>
                      {isSyncing ? "Syncing…" : "Sync Products"}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <BlockStack gap="400">
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={["Product", "Handle", "Type", "Status", "Last synced"]}
                    rows={rows}
                    increasedTableDensity
                  />
                </BlockStack>
              )}
            </Card>
          </div>

          <div className={styles.pagination}>
            <Button
              type="button"
              variant="secondary"
              onClick={goToPreviousPage}
              disabled={cursorHistory.length === 0 || isLoading}
            >
              Previous
            </Button>
            <p className={styles.pageInfo}>
              Page {formatCount(currentPage)} of {formatCount(totalPages)}
            </p>
            <Button type="button" variant="secondary" onClick={goToNextPage} disabled={!hasMore || !nextCursor || isLoading}>
              Next
            </Button>
          </div>
        </div>
      </Container>
      <Frame>
        {toastState ? (
          <Toast content={toastState.content} error={toastState.error} onDismiss={() => setToastState(null)} />
        ) : null}
      </Frame>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
