-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "npCityRef" TEXT,
ADD COLUMN     "npPointRef" TEXT,
ADD COLUMN     "pickupWarehouseId" TEXT;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "addressRu" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "addressUk" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "cityRu" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "cityUk" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "isPickup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "schedule" JSONB,
ADD COLUMN     "sort" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickupWarehouseId_fkey" FOREIGN KEY ("pickupWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Данные: основной склад — это магазин в Одессе, из него можно забрать заказ; адрес — из «Контактов» (если заполнен).
UPDATE "Warehouse" SET
  "isPickup" = true,
  "cityUk" = 'Одеса',
  "cityRu" = 'Одесса',
  "addressUk" = COALESCE((SELECT "value"->>'addressUk' FROM "Setting" WHERE "key" = 'site.contacts'), ''),
  "addressRu" = COALESCE((SELECT "value"->>'addressRu' FROM "Setting" WHERE "key" = 'site.contacts'), '')
WHERE "isDefault" = true;
