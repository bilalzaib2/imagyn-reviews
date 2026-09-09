import type { CSSProperties, ReactNode } from "react";
import styles from "./card.module.css";

type CardProps = {
  children: ReactNode;
  className?: string;
  tone?: "default" | "subtle" | "quiet";
  // Passthrough only, same convention as Section's own style prop — e.g. a reveal-animation
  // delay custom property. Never read by this component itself.
  style?: CSSProperties;
};

export function Card({ children, className, tone = "default", style }: CardProps) {
  const toneClass = tone === "subtle" ? styles.subtle : tone === "quiet" ? styles.quiet : styles.default;

  return (
    <div className={[styles.card, toneClass, className].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  );
}
