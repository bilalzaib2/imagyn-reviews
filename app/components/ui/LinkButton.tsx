import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "./button.module.css";

type LinkButtonProps = {
  to: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  fullWidth?: boolean;
  className?: string;
};

export function LinkButton({
  to,
  children,
  variant = "secondary",
  fullWidth = false,
  className,
}: LinkButtonProps) {
  const variantClass =
    variant === "primary" ? styles.primary : variant === "ghost" ? styles.ghost : styles.secondary;

  return (
    <Link
      to={to}
      className={[styles.button, variantClass, fullWidth ? styles.fullWidth : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Link>
  );
}
