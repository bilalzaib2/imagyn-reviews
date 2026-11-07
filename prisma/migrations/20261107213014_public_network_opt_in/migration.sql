-- Public review-network sharing becomes opt-in.
--
-- OWNER DECISION, 2026-11-08: "Keep publicNetworkEnabled = false by default. Public
-- review-network sharing must require explicit merchant opt-in."
--
-- ============================ READ BEFORE DEPLOYING ============================
--
-- The UPDATE below CHANGES EXISTING MERCHANT SETTINGS. That is deliberate, and it is the only
-- migration in this project that touches existing rows rather than only adding structure.
--
-- Why it is necessary: `publicNetworkEnabled` is a CONTROL, not a consent record. It stores a
-- current preference and never captured who agreed, when, or to what (see the field's own
-- comment in schema.prisma). So there is no way to distinguish a merchant who deliberately
-- switched sharing ON from one who simply inherited the old `true` default. Changing only the
-- default would leave every existing store sharing without having opted in, which is the exact
-- state this change exists to end.
--
-- What it costs: a merchant who DID deliberately enable sharing is switched off and must
-- re-enable it. That is the safe direction to be wrong in — sharing less review data than a
-- merchant wanted is recoverable in one click; sharing more than they agreed to is not.
--
-- What it does NOT do: no Review row is edited, unpublished or deleted. Storefront widgets, the
-- merchant dashboard and every private API are unaffected. Only what the public network may
-- read changes. Development stores were already excluded independently of this flag.
--
-- Reversal: see rollback.sql. Note that reversing restores the old DEFAULT but cannot restore
-- individual merchants' previous values, because they were not recorded anywhere.
--
-- ===============================================================================

-- 1. New stores are private unless the merchant opts in.
ALTER TABLE "Store" ALTER COLUMN "publicNetworkEnabled" SET DEFAULT false;

-- 2. Existing stores stop sharing until they opt in explicitly.
UPDATE "Store" SET "publicNetworkEnabled" = false WHERE "publicNetworkEnabled" = true;
