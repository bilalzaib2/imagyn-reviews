-- CreateEnum
CREATE TYPE "HelpfulVoteValue" AS ENUM ('HELPFUL', 'NOT_HELPFUL');

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "notHelpfulCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReviewHelpfulVote" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "vote" "HelpfulVoteValue" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewHelpfulVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewHelpfulVote_reviewId_vote_idx" ON "ReviewHelpfulVote"("reviewId", "vote");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewHelpfulVote_reviewId_visitorId_key" ON "ReviewHelpfulVote"("reviewId", "visitorId");

-- CreateIndex
CREATE INDEX "Review_helpfulCount_idx" ON "Review"("helpfulCount");

-- AddForeignKey
ALTER TABLE "ReviewHelpfulVote" ADD CONSTRAINT "ReviewHelpfulVote_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

