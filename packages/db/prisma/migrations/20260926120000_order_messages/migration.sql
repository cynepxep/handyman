-- AlterEnum
ALTER TYPE "OutboxState" ADD VALUE 'NO_CHANNEL';

-- AlterTable
ALTER TABLE "OrderStatusTemplate" ADD COLUMN     "sort" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Outbox" ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'manager',
ADD COLUMN     "who" TEXT;

