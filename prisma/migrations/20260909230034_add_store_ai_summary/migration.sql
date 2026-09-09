-- CreateTable
CREATE TABLE "StoreAiSummary" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "positives" TEXT NOT NULL,
    "negatives" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "reviewCountUsed" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreAiSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreAiSummary_storeId_key" ON "StoreAiSummary"("storeId");

-- AddForeignKey
ALTER TABLE "StoreAiSummary" ADD CONSTRAINT "StoreAiSummary_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
