-- Rescope the single, misleadingly-named aiSummaryOnWidgetEnabled flag (which in practice
-- only ever gated the Store Reviews widget) into three correctly-scoped, independent flags:
-- aiSummaryOnProductReviewsEnabled (new), aiSummaryOnStoreReviewsEnabled (replaces
-- aiSummaryOnWidgetEnabled), aiSummaryOnCarouselEnabled (new).
--
-- Order matters: add the new columns first, backfill aiSummaryOnStoreReviewsEnabled from
-- the old column's real per-row value, THEN drop the old column. Dropping first (or a plain
-- generated diff) would lose every store's existing on/off state instead of preserving it.

-- AlterTable: add the new columns
ALTER TABLE "Store"
  ADD COLUMN "aiSummaryOnProductReviewsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "aiSummaryOnStoreReviewsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiSummaryOnCarouselEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every store keeps the exact on/off state it had before this migration
UPDATE "Store" SET "aiSummaryOnStoreReviewsEnabled" = "aiSummaryOnWidgetEnabled";

-- AlterTable: drop the old column only after the backfill above has run
ALTER TABLE "Store" DROP COLUMN "aiSummaryOnWidgetEnabled";
