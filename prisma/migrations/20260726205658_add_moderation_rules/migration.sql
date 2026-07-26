-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "moderationReason" TEXT,
ADD COLUMN     "moderationStatus" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "moderationBannedWords" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "moderationHoldLinks" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "moderationHoldProfanity" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "moderationMinRating" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "moderationNotifyEmail" TEXT,
ADD COLUMN     "moderationNotifyOnHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "moderationRequireVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "moderationRulesEnabled" BOOLEAN NOT NULL DEFAULT false;
