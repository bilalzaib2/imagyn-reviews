-- AlterTable: order-lifecycle automation settings on Store
ALTER TABLE "Store" ADD COLUMN "autoRequestEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Store" ADD COLUMN "autoRequestDelayDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "Store" ADD COLUMN "autoRequestTrigger" TEXT NOT NULL DEFAULT 'fulfillment';

-- AlterTable: order linkage, source, and retry tracking on ReviewRequest
ALTER TABLE "ReviewRequest" ADD COLUMN "shopifyOrderId" TEXT;
ALTER TABLE "ReviewRequest" ADD COLUMN "shopifyLineItemId" TEXT;
ALTER TABLE "ReviewRequest" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "ReviewRequest" ADD COLUMN "sendAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex: one review request per (order, product) line item; NULLs (manual requests) are exempt
CREATE UNIQUE INDEX "ReviewRequest_shopifyOrderId_productId_key" ON "ReviewRequest"("shopifyOrderId", "productId");

-- CreateIndex
CREATE INDEX "ReviewRequest_status_idx" ON "ReviewRequest"("status");

-- CreateIndex
CREATE INDEX "ReviewRequest_scheduledFor_idx" ON "ReviewRequest"("scheduledFor");
