---
name: db-migration
description: Новая таблица или поле в базе (Prisma) — порядок правки schema.prisma, миграция (в том числе при запущенном сайте), генерация клиента, сид, документация. Используй перед любой правкой packages/db/prisma/schema.prisma.
---

# Миграция базы (Prisma)

1. Правь `packages/db/prisma/schema.prisma`. **Только добавляющие миграции** (новые таблицы/поля, без удаления и переименования).
2. Обнови `docs/MIGRATION-NOTES.md` (соответствие старой и новой схемы).
3. Обычный путь: `pnpm db:migrate:dev --name <имя>` — создаёт миграцию и генерирует клиент.
4. Если сайт запущен и его нельзя останавливать:
   `prisma migrate diff --from-schema-datasource … --to-schema-datamodel … --script` → файл миграции в `prisma/migrations/<дата>_<имя>/migration.sql`
   → `migrate deploy` → `prisma generate` (на Windows файл движка может быть занят — JS и типы всё равно обновятся).
   **После этого `next dev` обязательно перезапустить** (иначе падают его рабочие процессы).
5. На Windows перед миграцией останови `next dev` целиком (см. навык `windows-env`), иначе `EPERM ... rename`.
6. Новое право доступа: сначала `packages/core/src/permissions.ts`, потом сид роли в `packages/db/prisma/seed.ts`, потом `PERMISSION_LABELS_RU`;
   существующим ролям — миграцией `RolePermission` (`pnpm db:seed` перезаписывает права ролей — осторожно).
7. Интеграционные тесты накатывают миграции на `handyman_test` сами: `pnpm test` после миграции должен быть зелёным.
