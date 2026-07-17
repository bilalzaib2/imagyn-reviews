import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./button.module.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  fullWidth?: boolean;
};

export function Button({
  children,
  className,
  variant = "secondary" as NonNullable<ButtonProps["variant"]>,
  fullWidth = false,
  ...props
}: ButtonProps) {
  const variantClass =
    variant === "primary"
      ? styles.primary
      : variant === "ghost"
        ? styles.ghost
        : styles.secondary;

  return (
    <button
      className={[styles.button, variantClass, fullWidth ? styles.fullWidth : "", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
