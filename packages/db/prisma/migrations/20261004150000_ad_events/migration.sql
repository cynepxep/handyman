-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "adContext" JSONB;

-- CreateTable
CREATE TABLE "AdEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextTryAt" TIMESTAMP(3),
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "stub" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdEvent_state_nextTryAt_idx" ON "AdEvent"("state", "nextTryAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdEvent_orderId_platform_kind_key" ON "AdEvent"("orderId", "platform", "kind");

-- AddForeignKey
ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

