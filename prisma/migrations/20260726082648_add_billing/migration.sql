-- AlterTable: Shopify Billing state cache on Store
ALTER TABLE "Store" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'starter';
ALTER TABLE "Store" ADD COLUMN "planStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Store" ADD COLUMN "shopifySubscriptionId" TEXT;
ALTER TABLE "Store" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Store" ADD COLUMN "isDevelopmentStore" BOOLEAN;
