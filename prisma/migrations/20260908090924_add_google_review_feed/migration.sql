-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "googleFeedEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "googleFeedToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Store_googleFeedToken_key" ON "Store"("googleFeedToken");

