-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "cart" JSONB,
ADD COLUMN     "cartUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "cartVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ClientFavorite" (
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFavorite_pkey" PRIMARY KEY ("clientId","productId")
);

-- CreateTable
CREATE TABLE "ClientTool" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientTool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientFavorite_productId_idx" ON "ClientFavorite"("productId");

-- CreateIndex
CREATE INDEX "ClientTool_productId_idx" ON "ClientTool"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientTool_clientId_productId_key" ON "ClientTool"("clientId", "productId");

-- AddForeignKey
ALTER TABLE "ClientFavorite" ADD CONSTRAINT "ClientFavorite_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFavorite" ADD CONSTRAINT "ClientFavorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTool" ADD CONSTRAINT "ClientTool_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTool" ADD CONSTRAINT "ClientTool_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

