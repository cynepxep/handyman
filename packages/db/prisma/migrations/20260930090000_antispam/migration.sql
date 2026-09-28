-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedBy" TEXT,
ADD COLUMN     "blockedNote" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "suspicious" TEXT;

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");

-- CreateIndex
CREATE INDEX "Order_recipientPhone_createdAt_idx" ON "Order"("recipientPhone", "createdAt");

