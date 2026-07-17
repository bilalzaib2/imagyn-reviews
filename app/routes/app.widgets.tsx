import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { authenticate } from "../shopify.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.management.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function WidgetsPage() {
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  return (
    <Container as="main">
      <div className={`${shellStyles.page} ${styles.page}`}>
        <header className={`${shellStyles.header} ${styles.header}`}>
          <div className={shellStyles.headerContent}>
            <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
            <h1 className={`${shellStyles.title} ${styles.title}`}>Widgets</h1>
            <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>Configure how reviews appear across your storefront.</p>
          </div>
        </header>

        {isLoading ? <p className={styles.mutedText}>Refreshing widgets…</p> : null}

        <Section title="Widget library" description="Review widgets will be configurable in a future phase.">
          <div className={styles.emptyState}>
            <h2 className={styles.emptyTitle}>No widgets configured</h2>
            <p className={styles.emptyText}>Widget setup is planned for a later phase. This page is ready for integration.</p>
          </div>
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
