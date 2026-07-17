import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { Card } from "../components/ui/Card";
import { authenticate } from "../shopify.server";
import { reviewRequestService } from "../services/review-request.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.management.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  try {
    const requests = await reviewRequestService.list();
    return { requests, error: null };
  } catch (error) {
    return {
      requests: [],
      error: error instanceof Error ? error.message : "Unable to load review requests.",
    };
  }
};

export default function RequestsPage() {
  const { requests, error } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  return (
    <Container as="main">
      <div className={`${shellStyles.page} ${styles.page}`}>
        <header className={`${shellStyles.header} ${styles.header}`}>
          <div className={shellStyles.headerContent}>
            <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
            <h1 className={`${shellStyles.title} ${styles.title}`}>Requests</h1>
            <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>Track and manage outbound review requests.</p>
          </div>
        </header>

        {error ? <p className={styles.errorText}>{error}</p> : null}
        {isLoading ? <p className={styles.mutedText}>Refreshing requests…</p> : null}

        <Section title="Recent requests" description={`Showing ${requests.length} request${requests.length === 1 ? "" : "s"}.`}>
          {requests.length === 0 ? (
            <div className={styles.emptyState}>
              <h2 className={styles.emptyTitle}>No review requests yet</h2>
              <p className={styles.emptyText}>Requests will appear here after outreach campaigns are sent.</p>
            </div>
          ) : (
            <div className={styles.list}>
              {requests.map((request) => {
                const requestedOn = new Intl.DateTimeFormat("en", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date(request.createdAt));

                return (
                  <article key={request.id} className={styles.requestRow}>
                    <div className={styles.requestTop}>
                      <h2 className={styles.requestTitle}>{request.name ?? "Unnamed customer"}</h2>
                      <span className={styles.pill}>{request.status}</span>
                    </div>
                    <p className={styles.requestMeta}>{request.email ?? "No email"}</p>
                    <p className={styles.requestMeta}>{request.product?.name ?? "General request"} • {request.store.name}</p>
                    <p className={styles.requestMeta}>Requested on {requestedOn}</p>
                  </article>
                );
              })}
            </div>
          )}
        </Section>
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
