-- Merchant notification for every new customer-submitted review (Phase 2).
--
-- Purely additive and non-destructive: two new columns on "Store", both with defaults that
-- reproduce the exact behavior every existing store has today (no notification is sent, no
-- recipient is configured). No existing column is renamed, retyped, or dropped; no data is
-- read, rewritten, or deleted; no backfill is needed, because the defaults ARE the correct
-- historical state. Safe to run against a live database with no downtime.
--
-- See Store.newReviewNotifyEnabled's own comment in schema.prisma for why this is a separate
-- setting from moderationNotifyOnHold/moderationNotifyEmail rather than a reuse of them.

-- AlterTable
ALTER TABLE "Store"
  ADD COLUMN "newReviewNotifyEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "newReviewNotifyEmail" TEXT;
