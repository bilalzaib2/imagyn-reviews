-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "reminder1DelayDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "reminderFinalDelayDays" INTEGER NOT NULL DEFAULT 7;
