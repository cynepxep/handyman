-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "doneAt" TIMESTAMP(3),
ADD COLUMN     "shopDeliveryCost" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "unitCost" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "who" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_month_idx" ON "Expense"("month");


-- Выполненные до шага 4.5 заказы: месяц выручки — по последнему изменению заказа (точной даты «Выполнен» не хранили).
UPDATE "Order" SET "doneAt" = "updatedAt" WHERE "status" = 'DONE' AND "doneAt" IS NULL;
