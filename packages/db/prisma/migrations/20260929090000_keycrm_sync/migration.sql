-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "keycrmAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "keycrmCheckedAt" TIMESTAMP(3),
ADD COLUMN     "keycrmError" TEXT,
ADD COLUMN     "keycrmNextTryAt" TIMESTAMP(3),
ADD COLUMN     "keycrmSentAt" TIMESTAMP(3),
ADD COLUMN     "keycrmState" TEXT,
ADD COLUMN     "keycrmStatusId" INTEGER,
ADD COLUMN     "keycrmStub" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "keycrmUuid" TEXT;

-- AlterTable
ALTER TABLE "PendingNotif" ADD COLUMN     "keycrmStatus" TEXT;

-- CreateIndex
CREATE INDEX "Order_keycrmState_idx" ON "Order"("keycrmState");

-- CreateIndex
CREATE INDEX "PendingNotif_orderId_resolved_idx" ON "PendingNotif"("orderId", "resolved");

