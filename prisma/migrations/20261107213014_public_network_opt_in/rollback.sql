-- Rollback for this migration. Prisma has no down-migrations, so it is recorded here.
--
-- This migration changes one column DEFAULT and touches no rows, so its rollback is a single
-- symmetrical statement and is completely lossless. Nothing needs restoring from a backup,
-- because nothing was overwritten.
--
-- (An earlier draft of the migration also reset every merchant's publicNetworkEnabled to
-- false, and this file had to carry a warning that the reset could not be undone — the
-- per-merchant values were never recorded anywhere. That UPDATE was removed on 2026-11-11 by
-- owner decision, which is what makes this rollback trivial now.)
--
-- Run against a LOCAL database only.

ALTER TABLE "Store" ALTER COLUMN "publicNetworkEnabled" SET DEFAULT true;

-- Prisma does not remove the history row itself:
-- DELETE FROM "_prisma_migrations" WHERE migration_name LIKE '%public_network_opt_in';
