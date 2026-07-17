import type { ElementType, ReactNode } from "react";
import styles from "./container.module.css";

type ContainerProps = {
  children: ReactNode;
  as?: ElementType;
  className?: string;
};

export function Container({
  children,
  as: Component = "div",
  className,
}: ContainerProps) {
  return (
    <Component className={[styles.container, className].filter(Boolean).join(" ")}>
      {children}
    </Component>
  );
}
