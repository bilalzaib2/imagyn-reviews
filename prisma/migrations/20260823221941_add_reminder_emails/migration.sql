-- AlterTable
ALTER TABLE "ReviewRequest" ADD COLUMN     "reminder1SentAt" TIMESTAMP(3),
ADD COLUMN     "reminderFinalSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "reminderEmailsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remindersEnabledAt" TIMESTAMP(3);
