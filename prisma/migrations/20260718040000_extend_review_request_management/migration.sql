ALTER TABLE "ReviewRequest" ADD COLUMN "orderNumber" TEXT;
ALTER TABLE "ReviewRequest" ADD COLUMN "customMessage" TEXT;
ALTER TABLE "ReviewRequest" ADD COLUMN "sentAt" DATETIME;
ALTER TABLE "ReviewRequest" ADD COLUMN "openedAt" DATETIME;
ALTER TABLE "ReviewRequest" ADD COLUMN "reviewedAt" DATETIME;