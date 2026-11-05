-- Cache the merchant's own Shopify brand logo so a brand-new install's review emails are
-- branded with their real logo without the merchant uploading anything.
--
-- Purely additive and non-destructive: two new nullable columns on "Store" with no defaults, so
-- every existing row keeps exactly the behaviour it has today (null = nothing cached yet, which
-- the resolver already treats as "no shop logo"). No existing column is renamed, retyped or
-- dropped; no data is read, rewritten or deleted; no backfill is required. Safe to run against a
-- live database with no downtime and no lock of consequence.
--
-- See Store.shopBrandLogoUrl's own comment in schema.prisma for why this is a fallback and never
-- an override of a merchant-uploaded logo.

-- AlterTable
ALTER TABLE "Store"
  ADD COLUMN "shopBrandLogoUrl" TEXT,
  ADD COLUMN "shopBrandLogoSyncedAt" TIMESTAMP(3);
