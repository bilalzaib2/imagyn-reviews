-- Review CRUD foundation
-- 1. Adds denormalized review statistics + lastSyncedAt to Product.
-- 2. Rebuilds Review: renames fields to the new naming (body->content, authorName->reviewerName,
--    authorEmail->reviewerEmail, merchantReply->reply), adds reviewerLocation/isPublished/
--    helpfulCount/featured, makes productId/rating/content/reviewerName required, and switches
--    the Product relation from SetNull to Cascade (every review must belong to exactly one product).
--    Existing lowercase status values ('pending'/'approved'/'rejected') are upgraded to the new
--    ReviewStatus enum values, and isPublished is backfilled true for previously-approved reviews.

PRAGMA foreign_keys=OFF;

-- Product: denormalized review statistics, recalculated by review.server.ts after every mutation.
ALTER TABLE "Product" ADD COLUMN "averageRating" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "totalReviews" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "rating5Count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "rating4Count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "rating3Count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "rating2Count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "rating1Count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "lastSyncedAt" DATETIME;

-- Review: table rebuild (SQLite can't alter nullability or foreign key actions in place).
CREATE TABLE "new_Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "reviewerEmail" TEXT,
    "reviewerLocation" TEXT,
    "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "reply" TEXT,
    "repliedAt" DATETIME,
    "photoUrls" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Review_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Review" (
    "id", "storeId", "productId", "rating", "title", "content",
    "reviewerName", "reviewerEmail", "reviewerLocation", "verifiedPurchase",
    "status", "isPublished", "helpfulCount", "featured",
    "reply", "repliedAt", "photoUrls", "deletedAt", "createdAt", "updatedAt"
)
SELECT
    "id", "storeId", "productId", "rating", "title", "body",
    "authorName", "authorEmail", NULL, "verifiedPurchase",
    UPPER("status"),
    CASE WHEN UPPER("status") = 'APPROVED' THEN true ELSE false END,
    0, false,
    "merchantReply", "repliedAt", "photoUrls", "deletedAt", "createdAt", "updatedAt"
FROM "Review";

DROP TABLE "Review";
ALTER TABLE "new_Review" RENAME TO "Review";

CREATE INDEX "Review_deletedAt_createdAt_idx" ON "Review"("deletedAt", "createdAt");
CREATE INDEX "Review_storeId_deletedAt_createdAt_idx" ON "Review"("storeId", "deletedAt", "createdAt");
CREATE INDEX "Review_productId_deletedAt_idx" ON "Review"("productId", "deletedAt");
CREATE INDEX "Review_status_idx" ON "Review"("status");
CREATE INDEX "Review_rating_idx" ON "Review"("rating");
CREATE INDEX "Review_verifiedPurchase_idx" ON "Review"("verifiedPurchase");
CREATE INDEX "Review_featured_idx" ON "Review"("featured");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
