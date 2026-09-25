-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "localAt" TIMESTAMP(3),
ADD COLUMN     "localBytes" INTEGER,
ADD COLUMN     "localError" TEXT,
ADD COLUMN     "localUrl" TEXT;

-- CreateTable
CREATE TABLE "MediaSyncRun" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "savedKb" INTEGER NOT NULL DEFAULT 0,
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "who" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MediaSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaSyncRun_supplierId_startedAt_idx" ON "MediaSyncRun"("supplierId", "startedAt");

-- CreateIndex
CREATE INDEX "ProductImage_localUrl_idx" ON "ProductImage"("localUrl");
