import { useEffect, useState } from "react";
import { Link, useFetcher, useLoaderData, useLocation, useNavigation, useRevalidator, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  AppProvider as PolarisAppProvider,
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  EmptyState,
  Frame,
  SkeletonBodyText,
  SkeletonDisplayText,
  Toast,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { Container } from "../components/ui/Container";
import { authenticate } from "../shopify.server";
import { getOrCreateStore } from "../services/store.server";
import { getProducts, syncProducts } from "../services/product.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.products.module.css";

type ProductListItem = Awaited<ReturnType<typeof getProducts>>[number];

type ActionData = {
  ok: boolean;
  message?: string;
  error?: string;
  partial?: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const store = await getOrCreateStore(session.shop);
    const products = await getProducts(store.id);

    return {
      products,
      error: null as string | null,
    };
  } catch (error) {
    return {
      products: [] as ProductListItem[],
      error: error instanceof Error ? error.message : "Unable to load products.",
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const result = await syncProducts(admin, session.shop);

    if (result.totalCount === 0) {
      return { ok: true, message: "No products found in Shopify to sync." };
    }

    if (result.syncedCount === 0) {
      return {
        ok: false,
        error: `Unable to sync any of the ${result.totalCount} products found in Shopify.`,
      };
    }

    if (result.failedCount > 0) {
      return {
        ok: true,
        partial: true,
        message: `Synced ${result.syncedCount} of ${result.totalCount} products. ${result.failedCount} failed.`,
      };
    }

    return {
      ok: true,
      message: `Synced ${result.syncedCount} product${result.syncedCount === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to sync products from Shopify.",
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

export default function ProductsPage() {
  const { products, error } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const location = useLocation();

  const isLoading = navigation.state !== "idle";
  const isSyncing = fetcher.state !== "idle";

  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!fetcher.data) {
      return;
    }

    if (!fetcher.data.ok) {
      setToastState({ content: fetcher.data.error || "Unable to sync products.", error: true });
      return;
    }

    setToastState({ content: fetcher.data.message || "Products synced.", error: Boolean(fetcher.data.partial) });
    revalidator.revalidate();
  }, [fetcher.data, revalidator]);

  const handleSync = () => {
    fetcher.submit({ _intent: "sync" }, { method: "post" });
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
    <PolarisAppProvider i18n={enTranslations}>
      <Container as="main">
        <div className={`${shellStyles.page} ${styles.page}`}>
          <header className={`${shellStyles.header} ${styles.header}`}>
            <div className={shellStyles.headerContent}>
              <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
              <h1 className={`${shellStyles.title} ${styles.title}`}>Products</h1>
              <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>
                Sync your Shopify catalog to connect products with reviews and widgets.
              </p>
            </div>
            <div className={styles.headerActions}>
              <Button onClick={handleSync} loading={isSyncing} disabled={isSyncing}>
                {isSyncing ? "Syncing…" : "Sync Products"}
              </Button>
            </div>
          </header>

          {error ? <Banner tone="critical">{error}</Banner> : null}

          <div className={styles.tableCard}>
            <Card>
              {isLoading ? (
                <div className={styles.skeletonTable}>
                  <SkeletonDisplayText size="small" />
                  <SkeletonBodyText lines={8} />
                </div>
              ) : products.length === 0 ? (
                <EmptyState
                  heading="No products synced yet"
                  action={{ content: "Sync Products", onAction: handleSync, loading: isSyncing }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Sync your Shopify catalog to bring products into Imagyn Reviews.</p>
                </EmptyState>
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
    </PolarisAppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
