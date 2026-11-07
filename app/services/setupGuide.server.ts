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
  const [store, totalReviews, totalRequests, appearance, configuredWidgets] = await Promise.all([
    prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { planStatus: true } }),
    prisma.review.count({ where: { storeId, deletedAt: null } }),
    prisma.reviewRequest.count({ where: { storeId } }),
    appearanceService.getActive(storeId),
    prisma.widget.count({ where: { storeId } }),
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
      // The step without which nothing else matters: until a widget is on the storefront, a
      // shopper cannot read a review or leave one, and every other task here is preparation
      // for an audience of nobody. The benchmark puts storefront enablement first for the
      // same reason.
      //
      // WHY `done` READS A CONFIGURED WIDGET AND NOT A LIVE THEME
      //
      // Judge.me can say "App embeds missing from live theme" because it reads the theme.
      // That needs `read_themes`, which this app does not request, and adding a scope forces
      // every existing merchant to re-authorize — not a change to make quietly. So the label
      // states exactly what the signal proves: a widget has been set up here. The description
      // carries the part we cannot verify, rather than a checkbox implying we did.
      key: "widget",
      label: "Set up your review widget",
      description:
        "Choose how reviews appear on your storefront, then add the widget to your theme — reviews only show once it is in place.",
      href: "/app/widgets",
      done: configuredWidgets > 0,
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
