-- CreateTable
CREATE TABLE "ReviewSubmissionThrottle" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewSubmissionThrottle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewSubmissionThrottle_storeId_ipHash_createdAt_idx" ON "ReviewSubmissionThrottle"("storeId", "ipHash", "createdAt");

-- AddForeignKey
ALTER TABLE "ReviewSubmissionThrottle" ADD CONSTRAINT "ReviewSubmissionThrottle_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
