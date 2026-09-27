-- CreateEnum
CREATE TYPE "ReviewKind" AS ENUM ('REVIEW', 'QUESTION');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WatchKind" AS ENUM ('PRICE', 'STOCK');

-- AlterTable
ALTER TABLE "CompatibilityGroup" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "labelRu" TEXT;

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "ReviewKind" NOT NULL DEFAULT 'REVIEW',
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "rating" INTEGER,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "clientId" TEXT,
    "lang" "Locale" NOT NULL DEFAULT 'UK',
    "ipHash" TEXT,
    "answer" TEXT,
    "answeredBy" TEXT,
    "answeredAt" TIMESTAMP(3),
    "moderatedBy" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductWatch" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "WatchKind" NOT NULL,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "ProductWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Review_productId_status_idx" ON "Review"("productId", "status");

-- CreateIndex
CREATE INDEX "Review_status_createdAt_idx" ON "Review"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductWatch_notifiedAt_idx" ON "ProductWatch"("notifiedAt");

-- CreateIndex
CREATE INDEX "ProductWatch_productId_idx" ON "ProductWatch"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductWatch_clientId_productId_kind_key" ON "ProductWatch"("clientId", "productId", "kind");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductWatch" ADD CONSTRAINT "ProductWatch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductWatch" ADD CONSTRAINT "ProductWatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateIndex
CREATE INDEX "ProductCompatibility_groupId_idx" ON "ProductCompatibility"("groupId");

-- Шаг 5.6: право «Отзывы и вопросы: модерация» — владельцу, главному администратору и менеджеру
INSERT INTO "RolePermission" ("roleKey", "permission")
SELECT r."key", 'reviews.moderate' FROM "Role" r WHERE r."key" IN ('owner', 'admin', 'manager')
ON CONFLICT DO NOTHING;
