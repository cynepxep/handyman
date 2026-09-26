-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "refCode" TEXT,
ADD COLUMN     "referredById" TEXT,
ADD COLUMN     "tgStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ClientSession" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "via" TEXT;

-- CreateTable
CREATE TABLE "TgLogin" (
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgLogin_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "SmsCode" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsCode_phone_createdAt_idx" ON "SmsCode"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Client_refCode_key" ON "Client"("refCode");

-- CreateIndex
CREATE INDEX "Client_referredById_idx" ON "Client"("referredById");

