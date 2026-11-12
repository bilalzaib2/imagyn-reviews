import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import styles from "../../styles/shared.module.css";

type EmptyStateAction = { label: string; href: string };

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: EmptyStateAction;
}) {
  const navigate = useNavigate();

  return (
    <div className={styles.emptyState}>
      <h2 className={styles.emptyStateTitle}>{title}</h2>
      <p className={styles.emptyStateText}>{description}</p>
      {action ? (
        <button type="button" className={styles.emptyStateLink} onClick={() => navigate(action.href)}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
