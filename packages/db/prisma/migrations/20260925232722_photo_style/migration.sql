-- AlterTable
ALTER TABLE "MediaSyncRun" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'download';

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "styledAt" TIMESTAMP(3),
ADD COLUMN     "styledError" TEXT,
ADD COLUMN     "styledUrl" TEXT;
