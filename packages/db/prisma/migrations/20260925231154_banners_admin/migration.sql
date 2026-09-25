-- AlterTable
ALTER TABLE "Banner" ADD COLUMN     "buttonRu" TEXT,
ADD COLUMN     "buttonUk" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "settings" JSONB,
ADD COLUMN     "sort" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'light',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Banner_zone_visible_idx" ON "Banner"("zone", "visible");
