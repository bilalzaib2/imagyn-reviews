-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "rewardMinRating" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "rewardRequirePhoto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rewardRequireVerified" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rewardRequireVideo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rewardValue" DOUBLE PRECISION NOT NULL DEFAULT 10,
ADD COLUMN     "rewardValueType" TEXT NOT NULL DEFAULT 'percentage',
ADD COLUMN     "rewardsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "valueType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "discountCode" TEXT,
    "shopifyDiscountId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Reward_reviewId_key" ON "Reward"("reviewId");

-- CreateIndex
CREATE INDEX "Reward_storeId_idx" ON "Reward"("storeId");

-- CreateIndex
CREATE INDEX "Reward_status_idx" ON "Reward"("status");

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
