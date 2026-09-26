-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "recoveryCodes" JSONB;

-- AlterTable
ALTER TABLE "StaffSession" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userAgent" TEXT;

-- CreateTable
CREATE TABLE "StaffLoginChallenge" (
    "token" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StaffLoginChallenge_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "StaffLoginChallenge_staffId_idx" ON "StaffLoginChallenge"("staffId");

-- AddForeignKey
ALTER TABLE "StaffLoginChallenge" ADD CONSTRAINT "StaffLoginChallenge_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

