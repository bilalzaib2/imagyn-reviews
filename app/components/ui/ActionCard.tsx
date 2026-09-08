import type { ReactNode } from "react";
import { useLocation } from "react-router";
import buttonStyles from "./button.module.css";
import styles from "./action-card.module.css";

type ActionCardProps = {
  title: string;
  description: ReactNode;
  action: { label: string; href: string };
  badge?: ReactNode;
};

// A real, clickable feature entry — title + one-line description + a single obvious action —
// replacing bare text links wherever a Settings/Overview page needs to say "here's a thing
// you can configure." Always a real <a href>, never React Router's <Link>: this app's own
// embedded-context routing already established (see app.settings.tsx's sidebar) that a
// client-side pushState to a sub-route Shopify Admin's shell doesn't recognize gets silently
// reverted a few hundred ms later — every actual navigation in this app goes through a real
// anchor/window.location for that reason, and this component is no exception. Appends the
// current query string itself (host/shop/embedded/session params) so every caller gets that
// correctness for free instead of having to remember it per call site.
export function ActionCard({ title, description, action, badge }: ActionCardProps) {
  const location = useLocation();

  return (
    <div className={styles.card}>
      <div className={styles.copy}>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>{title}</h3>
          {badge}
        </div>
        <p className={styles.description}>{description}</p>
      </div>
      <a
        href={`${action.href}${location.search}`}
        className={`${buttonStyles.button} ${buttonStyles.secondary} ${styles.actionButton}`}
      >
        {action.label}
      </a>
    </div>
  );
}
