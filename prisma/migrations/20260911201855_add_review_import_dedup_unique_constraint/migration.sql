-- Real, DB-enforced defense-in-depth on top of the application-level check-before-create in
-- findExistingReview (reviewImportExport.server.ts) — closes the race-condition gap a
-- check-then-insert always has (e.g. two concurrent imports of the same file). Postgres
-- treats each NULL as distinct from every other NULL in a unique constraint, so this never
-- blocks organic reviews (importSource always null) or any import source with no per-row
-- externalId (Loox/Stamped/Ali Reviews) — it only ever fires for a genuine, exact
-- (storeId, importSource, externalId) repeat. Confirmed zero existing rows violate this before
-- adding it (see scripts/ directory history — checked via a temporary, since-deleted script).
CREATE UNIQUE INDEX "Review_storeId_importSource_externalId_key" ON "Review"("storeId", "importSource", "externalId");
