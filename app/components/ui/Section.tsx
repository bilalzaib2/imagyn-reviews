import type { ReactNode } from "react";
import styles from "./section.module.css";

type SectionProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Section({ title, description, actions, children, className }: SectionProps) {
  return (
    <section className={[styles.section, className].filter(Boolean).join(" ")}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{title}</h2>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {actions ? <div>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
