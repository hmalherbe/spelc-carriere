-- CreateEnum
CREATE TYPE "AdelSyncType" AS ENUM ('CCMA', 'CCMI');

-- CreateEnum
CREATE TYPE "AdelSyncStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "AdelSyncLog" (
    "id" TEXT NOT NULL,
    "type" "AdelSyncType" NOT NULL,
    "status" "AdelSyncStatus" NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "triggeredById" TEXT NOT NULL,

    CONSTRAINT "AdelSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdelSyncLog_type_syncedAt_idx" ON "AdelSyncLog"("type", "syncedAt");
