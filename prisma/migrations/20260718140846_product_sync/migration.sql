/*
  Warnings:

  - A unique constraint covering the columns `[shopifyProductId]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Product" ADD COLUMN "featuredImage" TEXT;
ALTER TABLE "Product" ADD COLUMN "handle" TEXT;
ALTER TABLE "Product" ADD COLUMN "productType" TEXT;
ALTER TABLE "Product" ADD COLUMN "shopifyProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN "status" TEXT;
ALTER TABLE "Product" ADD COLUMN "vendor" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_shopifyProductId_key" ON "Product"("shopifyProductId");
