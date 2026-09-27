-- CreateTable
CREATE TABLE "FiscalReceipt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "kind" TEXT NOT NULL,
    "payType" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "goods" JSONB NOT NULL,
    "relatedId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stub" BOOLEAN NOT NULL DEFAULT false,
    "fiscalCode" TEXT,
    "url" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextTryAt" TIMESTAMP(3),
    "sentToClientAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalReceipt_orderId_idx" ON "FiscalReceipt"("orderId");

-- CreateIndex
CREATE INDEX "FiscalReceipt_status_nextTryAt_idx" ON "FiscalReceipt"("status", "nextTryAt");

-- AddForeignKey
ALTER TABLE "FiscalReceipt" ADD CONSTRAINT "FiscalReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

