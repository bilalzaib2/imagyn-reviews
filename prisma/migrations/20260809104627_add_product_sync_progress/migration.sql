-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "productSyncStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "productSyncTotal" INTEGER,
ADD COLUMN     "productSyncSynced" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "productSyncFailed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "productSyncStartedAt" TIMESTAMP(3),
ADD COLUMN     "productSyncFinishedAt" TIMESTAMP(3),
ADD COLUMN     "productSyncError" TEXT;
