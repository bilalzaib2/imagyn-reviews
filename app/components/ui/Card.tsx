import type { ReactNode } from "react";
import styles from "./card.module.css";

type CardProps = {
  children: ReactNode;
  className?: string;
  tone?: "default" | "subtle" | "quiet";
};

export function Card({ children, className, tone = "default" }: CardProps) {
  const toneClass = tone === "subtle" ? styles.subtle : tone === "quiet" ? styles.quiet : styles.default;

  return <div className={[styles.card, toneClass, className].filter(Boolean).join(" ")}>{children}</div>;
}
