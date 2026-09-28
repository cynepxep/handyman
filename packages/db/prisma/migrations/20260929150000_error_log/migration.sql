-- Шаг 8.2: журнал ошибок (группы одинаковых ошибок) и право «errors.view» — владельцу и главному администратору.
-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "where" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "stack" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "digest" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowCount" INTEGER NOT NULL DEFAULT 1,
    "alertedAt" TIMESTAMP(3),
    "reopenedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErrorLog_fingerprint_key" ON "ErrorLog"("fingerprint");

-- CreateIndex
CREATE INDEX "ErrorLog_closedAt_lastAt_idx" ON "ErrorLog"("closedAt", "lastAt");

-- CreateIndex
CREATE INDEX "ErrorLog_lastAt_idx" ON "ErrorLog"("lastAt");


-- право «Ошибки сайта: просмотр» — существующим ролям owner и admin (новым установкам — через сид)
INSERT INTO "RolePermission" ("roleKey", "permission")
SELECT r."key", 'errors.view' FROM "Role" r WHERE r."key" IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
