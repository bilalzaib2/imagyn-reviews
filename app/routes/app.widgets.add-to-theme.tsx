import type { LoaderFunctionArgs } from "react-router";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";

// A plain <a target="_top"> doesn't reliably break out of Shopify Admin's embedded iframe —
// confirmed live: it landed correctly but produced no navigation. Same root cause as the
// billing "Upgrade" links (see app.billing.manage.tsx): only the authenticated admin
// context's own redirect(url, { target: "_top" }) is App Bridge-mediated and actually
// escapes the iframe, so every out-of-app link in this app goes through a GET loader like
// this one instead of a raw href. Validated against a fixed allow-list rather than trusting
// the query params directly — they're only ever set by this app's own widgetCards config,
// but there's no reason to let an open template/handle pair build an arbitrary
// admin.shopify.com URL.
//
// `kind` matters: Shopify's deep-link shape differs by the block's own {% schema %} `target`
// (theme-app-extensions/ux — confirmed against current shopify.dev docs). A "section" block
// (Star Rating, Rating Badge, Review Carousel — all `"target": "section"`) uses addAppBlockId
// + target=newAppsSection. An "embed" block (Collection Rating Badge — `"target": "body"`,
// see collection_rating_badges.liquid's own schema/settings comment: enabled once, globally,
// not placed per-section) uses activateAppId + context=apps instead, with no `target` param
// at all. Sending an embed block through the section shape is exactly what produced Shopify's
// "There is a problem with the app block" error for Collection Rating Badge — the other three
// blocks were never affected, since they're genuinely section blocks.
type BlockKind = "section" | "embed";

const ALLOWED_BLOCKS: Record<string, { template: "product" | "collection" | "index"; kind: BlockKind }> = {
  star_rating: { template: "product", kind: "section" },
  rating_badge: { template: "product", kind: "section" },
  collection_rating_badges: { template: "collection", kind: "embed" },
  // Store-wide, not per-product — opens on the homepage template, matching this block's
  // own default placement ("homepage-featured" in widget.shared.ts's defaultSettingsByType).
  review_carousel: { template: "index", kind: "section" },
  // Same reasoning as review_carousel above — store-wide, section-target, typically
  // homepage-placed.
  medals_showcase: { template: "index", kind: "section" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticateAdminDeduped(request);

  const handle = new URL(request.url).searchParams.get("handle") || "";
  const block = ALLOWED_BLOCKS[handle];
  if (!block) {
    throw new Response("Unknown block handle", { status: 400 });
  }

  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const url = new URL(`https://${session.shop}/admin/themes/current/editor`);
  url.searchParams.set("template", block.template);

  if (block.kind === "embed") {
    url.searchParams.set("context", "apps");
    url.searchParams.set("activateAppId", `${apiKey}/${handle}`);
  } else {
    url.searchParams.set("addAppBlockId", `${apiKey}/${handle}`);
    url.searchParams.set("target", "newAppsSection");
  }

  return redirect(url.toString(), { target: "_top" });
};
