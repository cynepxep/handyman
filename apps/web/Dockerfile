# Боевой образ сайта (шаг 8.4): витрина + админка + API + фоновые задачи и бот (lib/worker.ts) — всё в одном контейнере.
# Собирается из корня проекта: docker compose -f docker-compose.prod.yml build web  (или: docker build -f apps/web/Dockerfile .)
# Внутри: /app/apps/web/server.js — сайт (сборка Next.js «standalone»), /app/tools — пакет базы для служебных команд (`hm`: миграции,
# первый сид, пересборка поиска, резервные копии), pg_dump/pg_restore 16 — для копий (шаг 8.1). Работает не от root (пользователь handyman).
# Постоянные данные — в томах (docker-compose.prod.yml): /data (ключ шифрования, фиды), /media (фото), /backups (копии).
# Система образа — Ubuntu 24.04, как у сервера: клиент PostgreSQL 16 берётся из её стандартных пакетов (той же версии, что база).
# Node.js — из официального образа node:22 (сборка идёт в нём, в боевой образ копируется только программа node).

# сборка — в полном образе (в нём есть OpenSSL 3, как в Ubuntu 24.04: Prisma скачивает движки под неё)
ARG NODE_IMAGE=node:22-bookworm

# ---------- сборка ----------
FROM ${NODE_IMAGE} AS build
# pnpm той же версии, что в package.json (corepack не используем: его ключи подписи отстают от новых pnpm)
RUN npm install -g pnpm@12.6.0
# та же папка, что в боевом образе: собранный сайт ищет движок Prisma по пути сборки (/app/packages/db/generated/client)
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1

# сначала только описания пакетов — установка зависимостей кэшируется, пока они не меняются
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/bot/package.json apps/bot/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @handyman/db run generate
# NEXT_STANDALONE=1 включает output: "standalone" (apps/web/next.config.ts)
RUN NEXT_STANDALONE=1 pnpm --filter web build

# служебные команды: пакет базы со своими зависимостями (prisma, tsx, @handyman/core) в отдельной папке
RUN pnpm --filter @handyman/db deploy /tools \
 && cd /tools && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma \
 && rm -rf test

# ---------- боевой образ ----------
FROM ${NODE_IMAGE} AS node

FROM ubuntu:24.04 AS runtime
# pg_dump/pg_restore/psql 16 (как у базы postgres:16) — для резервных копий и ремонтов базы; wget — для проверки «жив ли сайт»
RUN export DEBIAN_FRONTEND=noninteractive && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 ca-certificates wget \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1001 --shell /usr/sbin/nologin handyman
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
# HM_CONTAINER — служебные команды пишут подсказки для сервера (hm …), а не для ПК (pnpm …)
ENV NODE_ENV=production HM_CONTAINER=1 \
    NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 \
    PORT=3000 HOSTNAME=0.0.0.0 \
    MEDIA_DIR=/media FEEDS_DIR=/data/feeds BACKUP_DIR=/backups SECRETS_KEY_FILE=/data/secrets.key

COPY --from=build --chown=handyman:handyman /app/apps/web/.next/standalone ./
COPY --from=build --chown=handyman:handyman /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=handyman:handyman /app/apps/web/public ./apps/web/public
COPY --from=build --chown=handyman:handyman /tools ./tools
# метка корня проекта (по ней код находит свои папки, см. projectRoot())
COPY pnpm-workspace.yaml ./
COPY --chmod=755 deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chmod=755 deploy/hm /usr/local/bin/hm
RUN mkdir -p /data/feeds /media /backups && chown -R handyman:handyman /data /media /backups

USER handyman
EXPOSE 3000
VOLUME ["/data", "/media", "/backups"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["entrypoint.sh"]
CMD ["web"]
