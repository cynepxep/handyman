-- CreateTable
CREATE TABLE "PayInvoice" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refunded" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'created',
    "pageUrl" TEXT NOT NULL,
    "stub" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "modifiedAt" TIMESTAMP(3),
    "checkUntil" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayInvoice_orderId_idx" ON "PayInvoice"("orderId");

-- CreateIndex
CREATE INDEX "PayInvoice_checkUntil_idx" ON "PayInvoice"("checkUntil");

-- AddForeignKey
ALTER TABLE "PayInvoice" ADD CONSTRAINT "PayInvoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

