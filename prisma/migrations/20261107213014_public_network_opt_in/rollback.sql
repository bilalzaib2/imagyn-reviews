-- Restores the previous DEFAULT only.
--
-- It CANNOT restore each merchant's prior value: publicNetworkEnabled is a control, not a
-- consent record, so the pre-migration per-store values were never captured anywhere. Running
-- the UPDATE below would turn sharing on for every store, including stores that never had it
-- on, so it is left commented out deliberately. Re-enabling is a merchant action.

ALTER TABLE "Store" ALTER COLUMN "publicNetworkEnabled" SET DEFAULT true;

-- Intentionally NOT provided as a live statement:
-- UPDATE "Store" SET "publicNetworkEnabled" = true;
