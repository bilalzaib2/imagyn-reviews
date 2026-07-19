-- One-time backfill for the denormalized Product review-statistics columns added in
-- review_crud_foundation, so existing products reflect their current reviews immediately
-- instead of reading as zero until their next review mutation triggers a recalculation.

UPDATE "Product"
SET
  "totalReviews" = (
    SELECT COUNT(*) FROM "Review"
    WHERE "Review"."productId" = "Product"."id" AND "Review"."deletedAt" IS NULL
  ),
  "averageRating" = COALESCE((
    SELECT ROUND(AVG("rating"), 1) FROM "Review"
    WHERE "Review"."productId" = "Product"."id" AND "Review"."deletedAt" IS NULL
  ), 0),
  "rating5Count" = (
    SELECT COUNT(*) FROM "Review"
    WHERE "Review"."productId" = "Product"."id" AND "Review"."deletedAt" IS NULL AND "Review"."rating" = 5
  ),
  "rating4Count" = (
    SELECT COUNT(*) FROM "Review"
    WHERE "Review"."productId" = "Product"."id" AND "Review"."deletedAt" IS NULL AND "Review"."rating" = 4
  ),
  "rating3Count" = (
    SELECT COUNT(*) FROM "Review"
    WHERE "Review"."productId" = "Product"."id" AND "Review"."deletedAt" IS NULL AND "Review"."rating" = 3
  ),
  "rating2Count" = (
    SELECT COUNT(*) FROM "Review"
    WHERE "Review"."productId" = "Product"."id" AND "Review"."deletedAt" IS NULL AND "Review"."rating" = 2
  ),
  "rating1Count" = (
    SELECT COUNT(*) FROM "Review"
    WHERE "Review"."productId" = "Product"."id" AND "Review"."deletedAt" IS NULL AND "Review"."rating" = 1
  );

-- Products that have already been synced from Shopify at least once get their existing
-- updatedAt carried over as a starting lastSyncedAt value, rather than reading as "never synced".
UPDATE "Product"
SET "lastSyncedAt" = "updatedAt"
WHERE "shopifyProductId" IS NOT NULL AND "lastSyncedAt" IS NULL;
