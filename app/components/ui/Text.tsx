// Headings and body copy at the app's own type scale. Replaces Polaris's <Text>, whose
// variants come from Shopify's scale rather than this one — a "headingMd" on a Polaris-built
// screen and a <Section> title on a house-built screen were two different sizes and weights
// for the same level of heading.
//
// Four variants, which is every variant the call sites this replaced actually used. The `as`
// prop is required rather than defaulted, because the element is a semantic decision (is this
// a real heading in the document outline, or a styled line of text?) and a default would let
// a screen ship an <h2> that is really a paragraph, or the reverse.
import type { ReactNode } from "react";

import styles from "./text.module.css";

export type TextVariant = "headingLg" | "headingMd" | "headingSm" | "body";

const VARIANT_CLASS: Record<TextVariant, string> = {
  headingLg: styles.headingLg,
  headingMd: styles.headingMd,
  headingSm: styles.headingSm,
  body: styles.body,
};

interface TextProps {
  as: "h1" | "h2" | "h3" | "h4" | "p" | "span";
  variant?: TextVariant;
  /** Secondary ink, for a line that supports the one above it. */
  tone?: "default" | "muted";
  children: ReactNode;
}

export function Text({ as: Tag, variant = "body", tone = "default", children }: TextProps) {
  return (
    <Tag className={[VARIANT_CLASS[variant], tone === "muted" ? styles.muted : ""].filter(Boolean).join(" ")}>
      {children}
    </Tag>
  );
}
