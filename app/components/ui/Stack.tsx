// A vertical stack with one gap. Replaces Polaris's <BlockStack>, which was the last reason
// five merchant screens imported a Polaris layout component.
//
// Deliberately tiny and deliberately vertical-only. Polaris's BlockStack carries align,
// inlineAlign, reverseOrder and a nine-step gap scale; not one of those was used at any of the
// call sites this replaced, and a horizontal row in this app is already a one-line flex rule
// in the screen's own stylesheet where it belongs.
//
// The gap names map onto the app's space scale rather than Polaris's numeric steps, so a stack
// gap and a card's padding are measured in the same units as everything else.
import type { ReactNode } from "react";

import styles from "./stack.module.css";

export type StackGap = "tight" | "snug" | "base" | "loose";

const GAP_CLASS: Record<StackGap, string> = {
  tight: styles.gapTight,
  snug: styles.gapSnug,
  base: styles.gapBase,
  loose: styles.gapLoose,
};

export function Stack({ gap = "base", children }: { gap?: StackGap; children: ReactNode }) {
  return <div className={`${styles.stack} ${GAP_CLASS[gap]}`}>{children}</div>;
}
