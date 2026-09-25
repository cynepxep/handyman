-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeliveryMethod" ADD VALUE 'PICKUP';
ALTER TYPE "DeliveryMethod" ADD VALUE 'TO_CONFIRM';

-- AlterEnum
ALTER TYPE "PayMode" ADD VALUE 'LATER';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "accessKey" TEXT,
ADD COLUMN     "deliveryType" TEXT,
ADD COLUMN     "lang" "Locale",
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "recipientPhone" TEXT,
ADD COLUMN     "source" TEXT;
