import prisma from "../db.server";
import { getAiProvider } from "./ai/provider.server";
import { assertPermission, getStorePermissions } from "./permissions";

export interface ReplyDraftResult {
  draft: string;
  provider: string;
  modelUsed: string;
}

// AI-assisted reply drafting — the model suggests a reply, the merchant reviews/edits it in
// the existing reply textarea, and only replyToReview (review.server.ts) — the same action a
// merchant already uses to publish a hand-typed reply — actually persists and publishes it.
// This function never writes to the Review row itself; it has no side effect beyond the AI
// provider call, exactly so a draft can never accidentally become a published reply without
// the merchant's own explicit "Publish" click.
//
// storeId-scoped lookup mirrors aiSummary.server.ts's regenerateAiSummary ownership check —
// without it, a merchant could draft (and, worse, leak review content from) another store's
// review just by knowing its id.
export async function draftReplyForReview(
  storeId: string,
  reviewId: string,
  existingDraft: string | null,
): Promise<ReplyDraftResult> {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, storeId, deletedAt: null },
    select: {
      rating: true,
      title: true,
      content: true,
      product: { select: { name: true } },
    },
  });

  if (!review) {
    throw new Error("Review not found.");
  }

  const permissions = await getStorePermissions(storeId);
  assertPermission(permissions, "canUseAI", "AI reply drafts require the Pro plan.", "growth");

  const provider = getAiProvider();
  const result = await provider.generateReplyDraft({
    productName: review.product.name,
    review: { rating: review.rating, title: review.title, content: review.content },
    existingDraft: existingDraft?.trim() || null,
  });

  return { draft: result.draft, provider: provider.name, modelUsed: result.modelUsed };
}
