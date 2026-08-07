import { Card } from "./Card";
import styles from "./upgrade-prompt.module.css";

type UpgradePromptProps = {
  // What the feature is called wherever a merchant would go looking for it — "Brand Studio",
  // "AI review summaries" — not a generic "This feature".
  feature: string;
  // What it does, in the merchant's terms — one sentence.
  description: string;
  // Why upgrading is the thing that unlocks it — ties the ask back to a concrete outcome
  // rather than just naming a plan.
  benefit: string;
  requiredPlanName: string;
  billingHref: string;
};

// The one gated-feature experience every locked screen in the app renders instead of hiding
// itself, crashing, or showing a dead button — see permissions.ts's header comment. A merchant
// who lacks a permission always lands here, always with a real explanation and a real way
// forward (a link to /app/billing, never a broken action).
export function UpgradePrompt({ feature, description, benefit, requiredPlanName, billingHref }: UpgradePromptProps) {
  return (
    <Card className={styles.card}>
      <p className={styles.eyebrow}>{requiredPlanName} feature</p>
      <h2 className={styles.title}>{feature}</h2>
      <p className={styles.description}>{description}</p>
      <p className={styles.benefit}>{benefit}</p>
      <a href={billingHref} className={styles.cta}>
        Upgrade to {requiredPlanName}
      </a>
    </Card>
  );
}
