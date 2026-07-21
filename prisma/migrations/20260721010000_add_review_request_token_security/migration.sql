-- AlterTable
ALTER TABLE "ReviewRequest" ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "tokenUsedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_requestToken_key" ON "ReviewRequest"("requestToken");

