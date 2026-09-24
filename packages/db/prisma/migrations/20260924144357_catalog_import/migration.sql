/*
  Warnings:

  - The primary key for the `FeedCategoryMap` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `supplierId` to the `FeedCategoryMap` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'RUNNING', 'DONE', 'FAILED');

-- DropForeignKey
ALTER TABLE "FeedCategoryMap" DROP CONSTRAINT "FeedCategoryMap_categoryId_fkey";

-- AlterTable
ALTER TABLE "FeedCategoryMap" DROP CONSTRAINT "FeedCategoryMap_pkey",
ADD COLUMN     "skip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supplierId" TEXT NOT NULL,
ALTER COLUMN "categoryId" DROP NOT NULL,
ADD CONSTRAINT "FeedCategoryMap_pkey" PRIMARY KEY ("supplierId", "path");

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "articleCode" TEXT,
ADD COLUMN     "missingFromFeedSince" TIMESTAMP(3),
ADD COLUMN     "supplierAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supplierUrl" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "defaultBrand" TEXT,
ADD COLUMN     "feedUrl" TEXT;

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceRef" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "feedFile" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "report" JSONB,
    "error" TEXT,
    "who" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportRun_supplierId_startedAt_idx" ON "ImportRun"("supplierId", "startedAt");

-- AddForeignKey
ALTER TABLE "FeedCategoryMap" ADD CONSTRAINT "FeedCategoryMap_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedCategoryMap" ADD CONSTRAINT "FeedCategoryMap_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
