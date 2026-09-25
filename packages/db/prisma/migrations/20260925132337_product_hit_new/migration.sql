-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isHit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isNew" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Product_isHit_idx" ON "Product"("isHit");

-- CreateIndex
CREATE INDEX "Product_isNew_idx" ON "Product"("isNew");
