-- CreateTable
CREATE TABLE "TrustCertification" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewPracticesStatus" TEXT NOT NULL,
    "reviewPracticesPercent" DOUBLE PRECISION,
    "reviewPracticesReason" TEXT,
    "paymentMethodsStatus" TEXT NOT NULL,
    "paymentMethodsDetail" TEXT,
    "policyStatus" TEXT NOT NULL,
    "policyDetail" TEXT,
    "storeHistoryStatus" TEXT NOT NULL,
    "storeHistoryDetail" TEXT,
    "verifiedReviewCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedAverageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "everCertified" BOOLEAN NOT NULL DEFAULT false,
    "certifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustCertification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrustCertification_storeId_key" ON "TrustCertification"("storeId");

-- CreateIndex
CREATE INDEX "TrustCertification_storeId_idx" ON "TrustCertification"("storeId");

-- AddForeignKey
ALTER TABLE "TrustCertification" ADD CONSTRAINT "TrustCertification_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
