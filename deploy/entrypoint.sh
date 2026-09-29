#!/bin/sh
# Запуск контейнера сайта (шаг 8.4).
#   web (по умолчанию) — обновить базу (миграции + ремонты), при необходимости собрать поиск (в фоне), запустить сайт.
#   служебная команда `hm` (например: docker compose -f docker-compose.prod.yml run --rm web seed) или любая программа (ls /backups).
# Сид (роли и owner) здесь НЕ запускается: он перезаписывает права ролей — только один раз вручную на пустой базе (deploy/README.md).
set -e

case "${1:-web}" in
  web) ;;
  migrate|seed|reindex|ensure-search|backup-now|backup-check|backup-restore|help) exec hm "$@" ;;
  *) exec "$@" ;;
esac

echo "[start] обновляю базу данных…"
hm migrate
# поиск собирается сам, только если его ещё нет (новый сервер, пустой том поиска); сайт при этом уже работает
(hm ensure-search || true) &

echo "[start] запускаю сайт"
cd /app/apps/web
exec node server.js
