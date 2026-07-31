import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// A plain <a target="_top"> doesn't reliably break out of Shopify Admin's embedded iframe —
// confirmed live: it landed correctly but produced no navigation. Same root cause as the
// billing "Upgrade" links (see app.billing.manage.tsx): only authenticate.admin(request)'s own
// redirect(url, { target: "_top" }) is App Bridge-mediated and actually escapes the iframe, so
// every out-of-app link in this app goes through a GET loader like this one instead of a raw
// href. Validated against a fixed allow-list rather than trusting the query params directly —
// they're only ever set by this app's own widgetCards config, but there's no reason to let an
// open template/handle pair build an arbitrary admin.shopify.com URL.
const ALLOWED_BLOCKS: Record<string, "product" | "collection"> = {
  star_rating: "product",
  rating_badge: "product",
  collection_rating_badges: "collection",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);

  const handle = new URL(request.url).searchParams.get("handle") || "";
  const template = ALLOWED_BLOCKS[handle];
  if (!template) {
    throw new Response("Unknown block handle", { status: 400 });
  }

  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const url = new URL(`https://${session.shop}/admin/themes/current/editor`);
  url.searchParams.set("template", template);
  url.searchParams.set("addAppBlockId", `${apiKey}/${handle}`);
  url.searchParams.set("target", "newAppsSection");

  return redirect(url.toString(), { target: "_top" });
};
