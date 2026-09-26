-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "assignee" TEXT,
    "orderId" TEXT,
    "clientId" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneBy" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "who" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCase" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "resolution" TEXT,
    "clientId" TEXT,
    "orderId" TEXT,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "serial" TEXT,
    "problem" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT,
    "who" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "who" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "ServiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_done_dueAt_idx" ON "Task"("done", "dueAt");

-- CreateIndex
CREATE INDEX "Task_orderId_idx" ON "Task"("orderId");

-- CreateIndex
CREATE INDEX "Task_clientId_idx" ON "Task"("clientId");

-- CreateIndex
CREATE INDEX "ServiceCase_status_idx" ON "ServiceCase"("status");

-- CreateIndex
CREATE INDEX "ServiceCase_clientId_idx" ON "ServiceCase"("clientId");

-- CreateIndex
CREATE INDEX "ServiceEvent_caseId_idx" ON "ServiceEvent"("caseId");

-- AddForeignKey
ALTER TABLE "ServiceEvent" ADD CONSTRAINT "ServiceEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

