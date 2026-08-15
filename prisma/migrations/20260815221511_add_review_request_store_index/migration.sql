-- CreateIndex
CREATE INDEX "ReviewRequest_storeId_status_createdAt_idx" ON "ReviewRequest"("storeId", "status", "createdAt");
