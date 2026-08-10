-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Achievement_storeId_idx" ON "Achievement"("storeId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "Achievement_storeId_key_key" ON "Achievement"("storeId", "key");

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
