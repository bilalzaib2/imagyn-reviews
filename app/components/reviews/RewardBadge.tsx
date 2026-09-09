import { Badge } from "@shopify/polaris";

interface RewardBadgeProps {
  reward: { status: string; discountCode: string | null; valueType: string; value: number } | null;
}

// Real Review Rewards outcome only — see rewards.server.ts's evaluateAndIssueReward for the
// three real terminal states ("issued"/"failed"/"ineligible"). "ineligible" is deliberately
// not rendered here at all: it's the default non-event for the vast majority of reviews (no
// reward was ever configured to apply), not a real state worth a badge — showing one for
// every non-rewarded review would be noise, not signal. A discount code is only ever shown
// once status is genuinely "issued" (see Reward.discountCode's own schema comment: set only
// after the real Shopify discountCodeBasicCreate mutation succeeds).
export function RewardBadge({ reward }: RewardBadgeProps) {
  if (!reward || reward.status === "ineligible") {
    return null;
  }

  if (reward.status === "issued") {
    const amount = reward.valueType === "percentage" ? `${reward.value}%` : `$${reward.value}`;
    return <Badge tone="success">{`Reward issued · ${amount}`}</Badge>;
  }

  if (reward.status === "failed") {
    return <Badge tone="critical">Reward failed</Badge>;
  }

  return null;
}
