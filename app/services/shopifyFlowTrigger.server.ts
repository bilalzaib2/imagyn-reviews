// Fires the "Review Created" Shopify Flow trigger (see
// extensions/review-created-flow-trigger/shopify.extension.toml) so a merchant can build their
// own Flow automation (Slack ping, internal ticket, etc.) off a genuine new review — separate
// from and earlier than the AI Summary/Reward hooks, which only fire once a review is approved.
//
// Prepared ahead of a Built for Shopify application (not itself a BFS submission — see
// docs/PROJECT_STATE.md), so this is real, working infrastructure a merchant can already use
// today, not a placeholder.

interface ReviewCreatedTriggerInput {
  storeDomain: string;
  // Product's real Shopify GID (Product.shopifyProductId) — null for a review whose product
  // was never synced from Shopify (shouldn't happen in practice, but never fabricate a
  // product_reference if it did).
  shopifyProductId: string | null;
  rating: number;
  title: string | null;
  content: string;
  reviewerName: string;
  verifiedPurchase: boolean;
}

const FLOW_TRIGGER_RECEIVE = `#graphql
  mutation FlowTriggerReceive($handle: String!, $payload: JSON!) {
    flowTriggerReceive(handle: $handle, payload: $payload) {
      userErrors {
        field
        message
      }
    }
  }
`;

// Must match extensions/review-created-flow-trigger/shopify.extension.toml's `handle` exactly.
const REVIEW_CREATED_HANDLE = "review-created";

// Flow trigger payloads stay well under the mutation's 50KB limit regardless, but review
// content has no app-enforced max length — truncate defensively rather than relying on that.
const MAX_CONTENT_LENGTH = 2000;

function extractLegacyResourceId(gid: string): number | null {
  const match = gid.match(/(\d+)$/);
  return match ? Number(match[1]) : null;
}

// Best-effort, fire-and-forget — a Flow API failure (or no Flow workflow even configured,
// which is the common case) must never break review creation. Same "never break the caller"
// convention as rewards.server.ts's evaluateAndIssueReward and aiSummary.server.ts's
// maybeAutoRegenerateAiSummary.
export async function notifyReviewCreatedFlowTrigger(input: ReviewCreatedTriggerInput): Promise<void> {
  const productId = input.shopifyProductId ? extractLegacyResourceId(input.shopifyProductId) : null;
  if (!productId) {
    return;
  }

  try {
    // Imported lazily, not at module scope — same reason shopifyDiscount.server.ts's
    // getAdminClient does: merely importing this file should never eagerly evaluate
    // shopify.server.ts's top-level PrismaSessionStorage construction.
    const { unauthenticated } = await import("../shopify.server");
    const { admin } = await unauthenticated.admin(input.storeDomain);

    const response = await admin.graphql(FLOW_TRIGGER_RECEIVE, {
      variables: {
        handle: REVIEW_CREATED_HANDLE,
        payload: {
          product_id: productId,
          Rating: input.rating,
          "Review Title": input.title ?? "",
          "Review Content": input.content.slice(0, MAX_CONTENT_LENGTH),
          "Reviewer Name": input.reviewerName,
          "Verified Purchase": input.verifiedPurchase,
        },
      },
    });

    const json = (await response.json()) as {
      data?: { flowTriggerReceive?: { userErrors: Array<{ field: string[] | null; message: string }> } };
    };
    const userErrors = json.data?.flowTriggerReceive?.userErrors ?? [];
    if (userErrors.length > 0) {
      console.error("[shopifyFlowTrigger] review-created trigger returned userErrors:", userErrors);
    }
  } catch (error) {
    console.error("[shopifyFlowTrigger] Failed to fire review-created trigger:", error);
  }
}
