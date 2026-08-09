-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE INDEX "Review_storeId_externalId_idx" ON "Review"("storeId", "externalId");
