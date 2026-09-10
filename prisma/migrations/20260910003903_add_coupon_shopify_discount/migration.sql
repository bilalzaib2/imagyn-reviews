-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "customerTargeting" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN     "discountCode" TEXT,
ADD COLUMN     "shopifyDiscountId" TEXT,
ADD COLUMN     "specificCustomerIds" TEXT;
