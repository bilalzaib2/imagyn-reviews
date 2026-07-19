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

export default function SettingsPage() {
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  return (
    <Container as="main">
      <div className={`${shellStyles.page} ${styles.page}`}>
        <header className={`${shellStyles.header} ${styles.header}`}>
          <div className={shellStyles.headerContent}>
            <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
            <h1 className={`${shellStyles.title} ${styles.title}`}>Settings</h1>
            <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>Manage app-level configuration and operational defaults.</p>
          </div>
        </header>

        {isLoading ? <p className={styles.mutedText}>Refreshing settings…</p> : null}

        <Section title="Configuration" description="Core settings will be available in an upcoming phase.">
          <div className={styles.emptyState}>
            <h2 className={styles.emptyTitle}>Settings are not configured yet</h2>
            <p className={styles.emptyText}>This page is prepared for account, preference, and policy controls.</p>
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
