import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "../../styles/shared.module.css";

type EmptyStateAction = { label: string; href: string };

// Reusable empty-list panel — same shared.module.css classes several routes already
// `composes` into their own stylesheet, now with a real component API (title/description/
// action) instead of every caller hand-rolling the same three-element JSX. Never populated
// with fake rows to look less empty — the honest empty state, with a real next action, is the
// point.
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: EmptyStateAction;
}) {
  return (
    <div className={styles.emptyState}>
      <h2 className={styles.emptyStateTitle}>{title}</h2>
      <p className={styles.emptyStateText}>{description}</p>
      {action ? <Link to={action.href}>{action.label}</Link> : null}
    </div>
  );
}
