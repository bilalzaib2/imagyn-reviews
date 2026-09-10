-- CreateTable
CREATE TABLE "SurfaceBrandOverride" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "surfaceKey" TEXT NOT NULL,
    "tokens" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurfaceBrandOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SurfaceBrandOverride_storeId_idx" ON "SurfaceBrandOverride"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "SurfaceBrandOverride_storeId_surfaceKey_key" ON "SurfaceBrandOverride"("storeId", "surfaceKey");

-- AddForeignKey
ALTER TABLE "SurfaceBrandOverride" ADD CONSTRAINT "SurfaceBrandOverride_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
