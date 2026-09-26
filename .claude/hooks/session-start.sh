#!/bin/bash
# Запуск облачного чата Claude Code (claude.ai/code): ставит зависимости, поднимает Postgres, Meilisearch и Redis
# без Docker, готовит базы handyman и handyman_test, чтобы `pnpm test`, `pnpm typecheck`, линтер и тесты в браузере
# работали так же, как на компьютере владельца. На компьютере владельца (Windows) ничего не делает.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"
log() { echo "[session-start] $*" >&2; }

# 1. Файл .env для облака: из шаблона .env.example (секретов там нет, только локальные значения).
#    Пароль первого входа владельца — случайный: в облаке сайт никому не виден.
if [ ! -f .env ]; then
  log "создаю .env из .env.example"
  sed "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$(openssl rand -hex 16)/" .env.example > .env
fi

# 2. Зависимости и клиент базы (pnpm install без --frozen-lockfile: пользуется кэшем контейнера).
log "pnpm install"
pnpm install --prefer-offline >&2
pnpm db:generate >&2

# 3. Postgres (установлен в контейнере) — пользователь и базы как в docker-compose.yml.
if ! pg_isready -q -h localhost -p 5432; then
  log "запускаю Postgres"
  service postgresql start >&2
  for _ in $(seq 1 30); do pg_isready -q -h localhost -p 5432 && break; sleep 1; done
fi
su postgres -c "psql -v ON_ERROR_STOP=1 -q" >&2 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'handyman') THEN
    CREATE ROLE handyman LOGIN PASSWORD 'handyman' CREATEDB;
  END IF;
END $$;
SQL
for db in handyman handyman_test; do
  if [ -z "$(su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname = '$db'\"")" ]; then
    log "создаю базу $db"
    su postgres -c "createdb -O handyman $db" >&2
  fi
done

# 4. Meilisearch (поиск) — та же версия, что в docker-compose.yml; ключ из .env.
MEILI_BIN=/opt/meili/meilisearch
if [ ! -x "$MEILI_BIN" ]; then
  log "скачиваю Meilisearch"
  mkdir -p /opt/meili
  curl -sSfL -o "$MEILI_BIN.tmp" https://github.com/meilisearch/meilisearch/releases/download/v1.11.3/meilisearch-linux-amd64
  chmod +x "$MEILI_BIN.tmp" && mv "$MEILI_BIN.tmp" "$MEILI_BIN"
fi
if ! curl -sf http://localhost:7700/health >/dev/null 2>&1; then
  log "запускаю Meilisearch"
  MEILI_KEY="$(grep -E '^MEILI_MASTER_KEY=' .env | cut -d= -f2- | sed 's/[[:space:]]*#.*//')"
  (cd /opt/meili && setsid nohup "$MEILI_BIN" --db-path /opt/meili/data --http-addr 127.0.0.1:7700 \
    --master-key "${MEILI_KEY:-change-me-search-key}" --no-analytics >/opt/meili/meili.log 2>&1 &)
  for _ in $(seq 1 30); do curl -sf http://localhost:7700/health >/dev/null 2>&1 && break; sleep 1; done
fi

# 5. Redis (фоновые задачи; кодом пока почти не используется, но есть в .env).
if ! redis-cli ping >/dev/null 2>&1; then
  service redis-server start >&2 || log "Redis не запустился (не критично)"
fi

# 6. Миграции рабочей базы и стартовые данные (сид — только в пустую базу: он перезаписывает права ролей).
pnpm db:migrate >&2
if [ -z "$(su postgres -c "psql -d handyman -tAc 'SELECT 1 FROM \"Role\" LIMIT 1'" 2>/dev/null)" ]; then
  log "заполняю стартовые данные (pnpm db:seed)"
  pnpm db:seed >&2
fi
# Пробный каталог (товары из образца фида) — только в пустую базу; заодно создаёт поисковый индекс.
(cd packages/db && pnpm exec dotenv -e ../../.env -- tsx scripts/demo-catalog.ts) >&2
# Поисковый индекс: без него главная витрины падает с ошибкой.
MEILI_KEY="$(grep -E '^MEILI_MASTER_KEY=' .env | cut -d= -f2- | sed 's/[[:space:]]*#.*//')"
if ! curl -sf -H "Authorization: Bearer ${MEILI_KEY}" http://localhost:7700/indexes/products >/dev/null 2>&1; then
  log "создаю поисковый индекс (pnpm search:reindex)"
  pnpm search:reindex >&2
fi

# 7. Тесты в браузере: вместо Google Chrome — Chromium, уже установленный в контейнере.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -x /opt/pw-browsers/chromium ]; then
  echo 'export E2E_CHROME_PATH=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi

log "готово: Postgres :5432, Meilisearch :7700, базы handyman и handyman_test"
