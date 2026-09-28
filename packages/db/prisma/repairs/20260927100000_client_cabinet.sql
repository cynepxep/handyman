-- Ремонт для базы, где незаконченная локальная сессия шага 5.5 уже создала часть «кабинета» по-своему
-- (ClientTool, ClientFavorite, колонки корзины в Client) — тогда миграция 20260927100000_client_cabinet падает с «already exists».
-- Старые данные НЕ теряются: копируются в таблицы *_backup_0928, после чего старые объекты убираются, и миграция применяется заново.
-- Запускает scripts/update-site.ps1 сам (prisma migrate resolve --rolled-back → этот файл → prisma migrate deploy).
DO $$
DECLARE cols text;
BEGIN
  -- миграция уже применена — ничего не трогаем (защита от повторного запуска)
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260927100000_client_cabinet' AND finished_at IS NOT NULL) THEN
    RETURN;
  END IF;

  IF to_regclass('"ClientTool"') IS NOT NULL THEN
    IF to_regclass('"ClientTool_backup_0928"') IS NULL THEN
      EXECUTE 'CREATE TABLE "ClientTool_backup_0928" AS SELECT * FROM "ClientTool"';
    END IF;
    EXECUTE 'DROP TABLE "ClientTool" CASCADE';
  END IF;

  IF to_regclass('"ClientFavorite"') IS NOT NULL THEN
    IF to_regclass('"ClientFavorite_backup_0928"') IS NULL THEN
      EXECUTE 'CREATE TABLE "ClientFavorite_backup_0928" AS SELECT * FROM "ClientFavorite"';
    END IF;
    EXECUTE 'DROP TABLE "ClientFavorite" CASCADE';
  END IF;

  SELECT string_agg(quote_ident(column_name), ', ') INTO cols
  FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name = 'Client' AND column_name IN ('cart', 'cartUpdatedAt', 'cartVersion');
  IF cols IS NOT NULL THEN
    IF to_regclass('"Client_cart_backup_0928"') IS NULL THEN
      EXECUTE format('CREATE TABLE "Client_cart_backup_0928" AS SELECT "id", %s FROM "Client"', cols);
    END IF;
    ALTER TABLE "Client" DROP COLUMN IF EXISTS "cart", DROP COLUMN IF EXISTS "cartUpdatedAt", DROP COLUMN IF EXISTS "cartVersion";
  END IF;
END $$;
