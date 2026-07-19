-- Corrective migration to match Prisma schema for Review.
ALTER TABLE "Review" ADD COLUMN "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Review_deletedAt_createdAt_idx" ON "Review"("deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Review_storeId_deletedAt_createdAt_idx" ON "Review"("storeId", "deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Review_status_idx" ON "Review"("status");
CREATE INDEX IF NOT EXISTS "Review_rating_idx" ON "Review"("rating");
CREATE INDEX IF NOT EXISTS "Review_verifiedPurchase_idx" ON "Review"("verifiedPurchase");
CREATE INDEX IF NOT EXISTS "Review_productId_idx" ON "Review"("productId");