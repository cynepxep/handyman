-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "blacklistNote" TEXT,
ADD COLUMN     "blacklisted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blacklistedAt" TIMESTAMP(3),
ADD COLUMN     "npRefusals" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "npFreeShipping" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "NpShipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ttn" TEXT NOT NULL,
    "ref" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "stub" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "payer" TEXT NOT NULL DEFAULT 'Recipient',
    "cost" DECIMAL(10,2),
    "cod" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "declared" DECIMAL(10,2),
    "weight" DOUBLE PRECISION,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "estDate" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'created',
    "statusCode" TEXT,
    "statusText" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "stuckAlertAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NpShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NpShipment_orderId_idx" ON "NpShipment"("orderId");

-- CreateIndex
CREATE INDEX "NpShipment_nextCheckAt_idx" ON "NpShipment"("nextCheckAt");

-- CreateIndex
CREATE INDEX "NpShipment_ttn_idx" ON "NpShipment"("ttn");

-- AddForeignKey
ALTER TABLE "NpShipment" ADD CONSTRAINT "NpShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

