-- Shared Email Branding: one logo pair per store, inherited by every customer-facing
-- review email template (request, reminders, reward).
--
-- Purely additive and non-destructive: two new nullable columns on "Store". No existing
-- column is renamed, retyped, or dropped; no data is read, rewritten, or deleted.
--
-- No backfill, deliberately. Existing merchants already have a logo stored inside each
-- EmailTemplate.content JSON, and those are left exactly as they are: the content
-- normaliser (email.shared.ts) infers logoSource: "custom" for any template that already
-- carries a logoUrl, so every existing template keeps rendering the precise asset it
-- renders today. These columns start NULL and take effect only once a merchant uploads a
-- shared logo in Email Studio, at which point templates still marked "shared" pick it up.
-- That makes the rollout incapable of blanking or replacing a merchant's existing asset.

-- AlterTable
ALTER TABLE "Store"
  ADD COLUMN "emailLogoUrl" TEXT,
  ADD COLUMN "emailLogoDarkUrl" TEXT;
