-- Verified Reply-To (Pro): a merchant address that customer replies are routed to, proven
-- by clicking a one-time link sent to that address.
--
-- Purely additive and non-destructive: five new nullable columns on "Store". No existing
-- column is renamed, retyped, or dropped; no data is read, rewritten, or deleted.
--
-- No backfill. NULL is the correct historical state: no store has a verified Reply-To yet,
-- and the existing per-template replyToEmail (EmailTemplate.content JSON) continues to work
-- exactly as it does today for every store. These columns only take effect once a merchant
-- saves an address AND completes verification.
--
-- replyToTokenHash stores a SHA-256 digest, never a usable token.

-- AlterTable
ALTER TABLE "Store"
  ADD COLUMN "replyToEmail" TEXT,
  ADD COLUMN "replyToVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "replyToTokenHash" TEXT,
  ADD COLUMN "replyToTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "replyToTokenSentAt" TIMESTAMP(3);
