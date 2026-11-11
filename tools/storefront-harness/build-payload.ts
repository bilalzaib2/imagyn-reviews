/**
 * Writes the fixture the local storefront harness serves in place of /apps/reviews/featured.
 *
 * The carousel settings and the CSS string come from carouselSettings.shared.ts — the same
 * module the real endpoint uses — so the harness exercises the real values rather than a
 * hand-written approximation of them. Pass a preset id to render that preset.
 *
 *   node --import tsx tools/storefront-harness/build-payload.ts [preset]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_CAROUSEL_SETTINGS,
  applyCarouselPreset,
  carouselCssText,
  normalizeCarouselSettings,
} from "../../app/services/carouselSettings.shared";

const presetId = process.argv[2];
const settings = presetId
  ? applyCarouselPreset(DEFAULT_CAROUSEL_SETTINGS, presetId)
  : normalizeCarouselSettings(DEFAULT_CAROUSEL_SETTINGS);

/** Deliberately the awkward cases: text-only, one image, many images, video, long body, low rating. */
const reviews = [
  {
    id: "r1",
    reviewerName: "Amelia R.",
    verifiedPurchase: true,
    rating: 5,
    title: "Exactly what I hoped for",
    content:
      "Arrived two days early and the finish is lovely — photos genuinely do not do it justice. I have already ordered a second one for my sister's birthday next month.",
    createdAt: "2026-11-09T10:00:00.000Z",
    product: { id: "p1", name: "Brown Ceramic Plate", handle: "brown-ceramic-plate", averageRating: 4.6, totalReviews: 24 },
    media: [{ type: "IMAGE", url: "/tools/storefront-harness/media/one.svg", thumbnailUrl: "/tools/storefront-harness/media/one.svg", width: 800, height: 600 }],
  },
  {
    id: "r2",
    reviewerName: "Jonas P.",
    verifiedPurchase: true,
    rating: 4,
    title: "Good, with one caveat",
    content: "Comfortable and well made. The sizing runs a little small, so size up if you are between sizes.",
    createdAt: "2026-11-04T10:00:00.000Z",
    product: { id: "p2", name: "Glacier Merino Hoodie", handle: "glacier-merino-hoodie", averageRating: 4.4, totalReviews: 11 },
    media: [],
  },
  {
    id: "r3",
    reviewerName: "Priya N.",
    verifiedPurchase: true,
    rating: 5,
    title: "Beautiful set",
    content:
      "Bought these for a dinner party and they were the thing everyone commented on. The glaze has a depth to it that is hard to photograph, though I have tried. Washing has not dulled them at all after a month of regular use, which is more than I can say for the last set I owned, and I am fussy about this sort of thing.",
    createdAt: "2026-10-20T10:00:00.000Z",
    product: { id: "p3", name: "Atlas Linen Bedding Set", handle: "atlas-linen-bedding-set", averageRating: 4.8, totalReviews: 37 },
    media: [
      { type: "IMAGE", url: "/tools/storefront-harness/media/two.svg", thumbnailUrl: "/tools/storefront-harness/media/two.svg", width: 800, height: 800 },
      { type: "IMAGE", url: "/tools/storefront-harness/media/three.svg", thumbnailUrl: "/tools/storefront-harness/media/three.svg", width: 800, height: 1000 },
      { type: "VIDEO", url: "/tools/storefront-harness/media/one.svg", thumbnailUrl: "/tools/storefront-harness/media/one.svg", width: 800, height: 600 },
    ],
  },
  {
    id: "r4",
    reviewerName: "Dana K.",
    verifiedPurchase: false,
    rating: 3,
    title: "Not quite for me",
    content: "Quality is fine but the colour is noticeably warmer than it looks on screen.",
    createdAt: "2026-10-08T10:00:00.000Z",
    product: { id: "p4", name: "Cirrus Ambient Lamp", handle: "cirrus-ambient-lamp", averageRating: 4.1, totalReviews: 9 },
    media: [{ type: "IMAGE", url: "/tools/storefront-harness/media/three.svg", thumbnailUrl: "/tools/storefront-harness/media/three.svg", width: 800, height: 1000 }],
  },
  {
    id: "r5",
    reviewerName: "Marcus T.",
    verifiedPurchase: true,
    rating: 5,
    title: "Third one I have bought",
    content: "Reliable, well packed, and the second one survived a house move without a chip.",
    createdAt: "2026-09-30T10:00:00.000Z",
    product: { id: "p5", name: "North Oak Dining Chair", handle: "north-oak-dining-chair", averageRating: 4.7, totalReviews: 16 },
    media: [{ type: "IMAGE", url: "/tools/storefront-harness/media/two.svg", thumbnailUrl: "/tools/storefront-harness/media/two.svg", width: 800, height: 800 }],
  },
];

const payload = {
  ok: true,
  widget: { widgetName: "Review Carousel", enabled: true, carousel: settings },
  carousel: settings,
  carouselCss: carouselCssText(settings),
  appearance: null,
  storeSummary: { averageRating: 4.6, totalReviews: 97 },
  aiSummary: null,
  reviews,
};

const out = join(process.cwd(), "tools", "storefront-harness", "payload.json");
writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(`wrote ${out}${presetId ? ` (preset: ${presetId})` : " (defaults)"}`);
console.log(`carouselCss: ${payload.carouselCss.slice(0, 90)}…`);

export {};
