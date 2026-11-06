-- Rollback for this migration. Prisma has no down-migrations, so it is recorded here.
--
-- Safe to run: every object below is created by this migration and by nothing else, so
-- dropping them cannot touch pre-existing data. Reviews, stores, products and requests are
-- untouched either way -- the two Review columns are nullable additions.
--
-- Run against a LOCAL database only.

ALTER TABLE "Review" DROP COLUMN IF EXISTS "hiddenReason";
ALTER TABLE "Review" DROP COLUMN IF EXISTS "hiddenAt";

DROP TABLE IF EXISTS "Question";
DROP TYPE IF EXISTS "QuestionStatus";

-- Then remove the migration's row so Prisma stops considering it applied:
-- DELETE FROM "_prisma_migrations" WHERE migration_name LIKE '%add_hide_reasons_and_questions';
