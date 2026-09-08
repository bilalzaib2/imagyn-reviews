import prisma from "../db.server";
import { appearanceService } from "./appearance.server";

export interface SetupGuideItem {
  key: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
}

// The Dashboard's "Getting started" checklist — every item reads a real, already-meaningful
// signal already tracked elsewhere in the product (a plan decision, a real review, a real
// request, a saved appearance theme). No manual "mark as done" toggle and no signal invented
// just for this list, so a merchant can never see a checked box that doesn't correspond to
// something real they actually did.
export async function getSetupGuideItems(storeId: string): Promise<SetupGuideItem[]> {
  const [store, totalReviews, totalRequests, appearance] = await Promise.all([
    prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { planStatus: true } }),
    prisma.review.count({ where: { storeId, deletedAt: null } }),
    prisma.reviewRequest.count({ where: { storeId } }),
    appearanceService.getActive(storeId),
  ]);

  return [
    {
      key: "plan",
      label: "Choose your plan",
      description: "Pick the plan that fits your store — Starter is free.",
      href: "/app/billing",
      done: store.planStatus !== "pending",
    },
    {
      key: "reviews",
      label: "Collect or import your first review",
      description: "Import from Judge.me, Loox, Stamped, or a generic CSV, or wait for your first customer review.",
      href: "/app/reviews",
      done: totalReviews > 0,
    },
    {
      key: "requests",
      label: "Send your first review request",
      description: "Ask a real customer for a review from a Shopify order, a customer list, or a CSV upload.",
      href: "/app/requests",
      done: totalRequests > 0,
    },
    {
      key: "brand",
      label: "Customize your brand appearance",
      description: "Match your storefront's colors, fonts, and layout to your brand.",
      href: "/app/appearance",
      done: appearance !== null,
    },
  ];
}
