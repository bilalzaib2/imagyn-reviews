-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "importSource" TEXT,
ADD COLUMN     "sourceVerified" BOOLEAN;

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "filename" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "heldForModeration" INTEGER NOT NULL DEFAULT 0,
    "unmatchedRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "errorDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_storeId_createdAt_idx" ON "ImportBatch"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_storeId_status_idx" ON "ImportBatch"("storeId", "status");

-- CreateIndex
CREATE INDEX "Review_importBatchId_idx" ON "Review"("importBatchId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
