-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "analyticsAt" TIMESTAMP(3),
ADD COLUMN     "utm" JSONB;
