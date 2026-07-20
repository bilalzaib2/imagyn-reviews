-- CreateTable
CREATE TABLE "ProductAiSummary" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "positives" TEXT NOT NULL,
    "negatives" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "reviewCountUsed" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAiSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductAiSummary_productId_key" ON "ProductAiSummary"("productId");

-- AddForeignKey
ALTER TABLE "ProductAiSummary" ADD CONSTRAINT "ProductAiSummary_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

