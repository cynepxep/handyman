-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMoveReason" ADD VALUE 'RESERVE';
ALTER TYPE "StockMoveReason" ADD VALUE 'UNRESERVE';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "minStock" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "docId" TEXT,
ADD COLUMN     "unitCost" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "StockDoc" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "supplier" TEXT,
    "note" TEXT,
    "who" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockDoc_createdAt_idx" ON "StockDoc"("createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_refOrderId_idx" ON "StockMovement"("refOrderId");

-- CreateIndex
CREATE INDEX "StockMovement_docId_idx" ON "StockMovement"("docId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_docId_fkey" FOREIGN KEY ("docId") REFERENCES "StockDoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Право «Склад» (stock.edit): владельцу, главному администратору и менеджеру (по ТЗ менеджер ведёт склад), если такие роли есть. Только добавление.
INSERT INTO "RolePermission" ("roleKey", "permission")
SELECT r."key", 'stock.edit' FROM "Role" r WHERE r."key" IN ('owner', 'admin', 'manager')
ON CONFLICT DO NOTHING;
