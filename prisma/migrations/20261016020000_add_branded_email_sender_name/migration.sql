-- Branded Email Sender Identity (Pro): the display name shown in a customer's inbox for
-- review requests and reminders.
--
-- Purely additive and non-destructive: one new nullable column on "Store". No existing
-- column is renamed, retyped, or dropped; no data is read, rewritten, or deleted; no
-- backfill is needed. NULL is the correct historical state for every existing store —
-- emailSenderIdentity.server.ts falls back to Store.name, which is precisely what every
-- send already uses today. Safe to run against a live database with no downtime.
--
-- Deliberately only a display name. The From address stays on the platform's verified
-- sending domain for every plan; see emailSenderIdentity.server.ts for why a
-- merchant-supplied From address is not offered here.

-- AlterTable
ALTER TABLE "Store"
  ADD COLUMN "emailSenderName" TEXT;
