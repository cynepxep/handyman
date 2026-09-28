-- AlterTable
ALTER TABLE "ImportRun" ADD COLUMN     "undoReport" JSONB,
ADD COLUMN     "undoneAt" TIMESTAMP(3),
ADD COLUMN     "undoneBy" TEXT;

-- CreateTable
CREATE TABLE "SupplierBrand" (
    "supplierId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,

    CONSTRAINT "SupplierBrand_pkey" PRIMARY KEY ("supplierId","brandId")
);

-- CreateTable
CREATE TABLE "FeedBrandMap" (
    "supplierId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "brandId" TEXT,
    "skip" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FeedBrandMap_pkey" PRIMARY KEY ("supplierId","vendor")
);

-- CreateTable
CREATE TABLE "ImportUndo" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "ImportUndo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierBrand_brandId_idx" ON "SupplierBrand"("brandId");

-- CreateIndex
CREATE INDEX "ImportUndo_runId_kind_idx" ON "ImportUndo"("runId", "kind");

-- AddForeignKey
ALTER TABLE "SupplierBrand" ADD CONSTRAINT "SupplierBrand_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBrand" ADD CONSTRAINT "SupplierBrand_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedBrandMap" ADD CONSTRAINT "FeedBrandMap_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedBrandMap" ADD CONSTRAINT "FeedBrandMap_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportUndo" ADD CONSTRAINT "ImportUndo_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

