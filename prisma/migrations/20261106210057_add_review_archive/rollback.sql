-- Rollback for this migration. Prisma has no down-migrations, so it is recorded here.
-- Both objects are created by this migration and by nothing else, so dropping them cannot
-- touch pre-existing data. Run against a LOCAL database only.

DROP INDEX IF EXISTS "Review_storeId_archivedAt_idx";
ALTER TABLE "Review" DROP COLUMN IF EXISTS "archivedAt";

-- DELETE FROM "_prisma_migrations" WHERE migration_name LIKE '%add_review_archive';
