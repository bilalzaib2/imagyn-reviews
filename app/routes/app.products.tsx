import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData, useLocation, useNavigation, useRevalidator, useRouteError } from "react-router";
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
import { getProducts } from "../services/product.server";
import { isProductSyncInProgress, runProductSync } from "../services/productSync.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.products.module.css";

type ProductListItem = Awaited<ReturnType<typeof getProducts>>[number];

type ActionData = {
  ok: boolean;
  started?: boolean;
  error?: string;
};

type LoaderData = {
  products: ProductListItem[];
  syncState: ProductSyncState | null;
  error: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);

  try {
    const store = await getOrCreateStore(session.shop);
    const [products, syncState] = await Promise.all([getProducts(store.id), getProductSyncState(store.id)]);

    return {
      products,
      syncState,
      error: null,
    };
  } catch (error) {
    return {
      products: [],
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
  const { products, syncState: initialSyncState, error } = useLoaderData<typeof loader>();
  const actionFetcher = useFetcher<ActionData>();
  const statusFetcher = useFetcher<ProductSyncState>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const location = useLocation();

  const isLoading = navigation.state !== "idle";

  const [syncState, setSyncState] = useState<ProductSyncState | null>(initialSyncState);
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);
  const prevStatusRef = useRef<ProductSyncState["status"] | null>(initialSyncState?.status ?? null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSyncing = syncState?.status === "running";
  const attempted = (syncState?.synced ?? 0) + (syncState?.failed ?? 0);
  const percent =
    syncState?.total && syncState.total > 0 ? Math.min(100, Math.round((attempted / syncState.total) * 100)) : null;

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
  // re-fetch and re-serialize the full product table on every tick.
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
  // product table (a new full-catalog sync can add/update far more rows than the initial page
  // load knew about) and shows the completion toast required by spec: "Successfully synced X
  // products."
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

  const rows = products.map((product: ProductListItem) => [
    <Link
      key={`${product.id}-image`}
      to={`/app/products/${product.id}${location.search}`}
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
    </Link>,
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

          <div className={styles.tableCard}>
            <Card>
              {isLoading ? (
                <div className={styles.skeletonTable}>
                  <SkeletonDisplayText size="small" />
                  <SkeletonBodyText lines={8} />
                </div>
              ) : products.length === 0 ? (
                <div className={styles.emptyState}>
                  <h2 className={styles.emptyStateTitle}>No products synced yet</h2>
                  <p className={styles.emptyStateText}>Sync your Shopify catalog to bring products into Imagyn Reviews.</p>
                  <Button type="button" onClick={handleSync} disabled={isSyncing || actionFetcher.state !== "idle"}>
                    {isSyncing ? "Syncing…" : "Sync Products"}
                  </Button>
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
