-- Add fields needed for realistic review metadata in MVP.
ALTER TABLE "Review" ADD COLUMN "authorEmail" TEXT;
ALTER TABLE "Review" ADD COLUMN "photoUrls" TEXT;