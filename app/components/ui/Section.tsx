import type { CSSProperties, ReactNode } from "react";
import styles from "./section.module.css";

type SectionProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  // Passthrough only — e.g. a caller-set custom property like a reveal-animation delay.
  // Never used by this component itself, so it can't affect any existing caller.
  style?: CSSProperties;
};

export function Section({ title, description, actions, children, className, style }: SectionProps) {
  return (
    <section className={[styles.section, className].filter(Boolean).join(" ")} style={style}>
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
