-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Review_storeId_archivedAt_idx" ON "Review"("storeId", "archivedAt");
