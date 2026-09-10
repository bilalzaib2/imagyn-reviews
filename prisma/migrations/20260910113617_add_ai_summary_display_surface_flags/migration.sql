-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "aiSummaryOnReviewSiteEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiSummaryOnWidgetEnabled" BOOLEAN NOT NULL DEFAULT false;
