#!/usr/bin/env bash
# Автообновление сайта на сервере: раз в 5 минут (таймер systemd, ставит deploy/install-auto-update.sh) проверяет, появилась ли
# на GitHub новая версия в main, и если да — запускает deploy/update.sh (копия → pull → сборка → перезапуск → проверка → откат при сбое).
# В чат менеджеров (hm notify) пишет только о проблемах (не обновилось, версия расходится); удачное обновление — только в журнал. Версию, которая не поднялась, повторно не собирает — ждёт следующей.
#   bash deploy/auto-update.sh            — проверить сейчас (то же, что делает таймер)
#   touch .auto-update/off                 — приостановить автообновление; rm .auto-update/off — включить снова
# Журнал — .auto-update/log (последние запуски), подробности последнего обновления — update-last.log.
# Для проверок: HM_UPDATE_CMD — вместо update.sh, HM_NOTIFY_CMD — вместо сообщения в Telegram, HM_BRANCH — ветка (main).
set -Euo pipefail

cd "$(dirname "$0")/.."
STATE="$PWD/.auto-update"
mkdir -p "$STATE"
LOG="$STATE/log"
BRANCH="${HM_BRANCH:-main}"
COMPOSE=(docker compose -f docker-compose.prod.yml)

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
notify() {
  if [ -n "${HM_NOTIFY_CMD:-}" ]; then "$HM_NOTIFY_CMD" "$1"; return 0; fi
  "${COMPOSE[@]}" exec -T web hm notify "$1" >/dev/null 2>&1 || log "сообщение менеджерам не отправлено: $1"
}

# только один запуск одновременно (таймер не наложится на долгую сборку)
exec 9>"$STATE/lock"
flock -n 9 || exit 0

[ -f "$STATE/off" ] && exit 0

# журнал не растёт бесконечно
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

if ! timeout 60 git fetch -q origin "$BRANCH" 2>>"$LOG"; then
  log "не удалось проверить GitHub (нет связи?) — попробую в следующий раз"
  exit 0
fi
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0
# новая версия должна продолжать нынешнюю (иначе git pull --ff-only в update.sh всё равно откажется)
if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  if [ "$(cat "$STATE/diverged" 2>/dev/null)" != "$REMOTE" ]; then
    echo "$REMOTE" > "$STATE/diverged"
    log "версия на сервере не совпадает с GitHub (свои правки на сервере?) — автообновление ждёт ручного"
    notify "⚠️ Автообновление сайта остановлено: версия на сервере расходится с GitHub. Нужна помощь Claude (журнал — /opt/handyman/.auto-update/log)."
  fi
  exit 0
fi
# эта версия уже не поднялась — не собирать её по кругу, ждать следующую
[ "$(cat "$STATE/failed" 2>/dev/null)" = "$REMOTE" ] && exit 0

SUBJECT=$(git log -1 --format=%s "$REMOTE")
SHORT=$(git rev-parse --short "$REMOTE")
log "найдена новая версия $SHORT «$SUBJECT» — обновляю"
UPDATE=(bash deploy/update.sh)
[ -n "${HM_UPDATE_CMD:-}" ] && UPDATE=("$HM_UPDATE_CMD")
if "${UPDATE[@]}" > /dev/null 2>&1; then
  rm -f "$STATE/failed" "$STATE/diverged"
  # удачное обновление — только в журнал (владелец: в Telegram — только ошибки)
  log "готово: сайт обновлён до $SHORT «$SUBJECT»"
else
  echo "$REMOTE" > "$STATE/failed"
  REASON=$(grep -m1 "НЕ ПОЛУЧИЛОСЬ" update-last.log 2>/dev/null | sed "s/^НЕ ПОЛУЧИЛОСЬ: //" | cut -c1-400 || true)
  log "НЕ ПОЛУЧИЛОСЬ обновить до $SHORT: ${REASON:-см. update-last.log}"
  notify "⚠️ Автообновление сайта до версии $SHORT не удалось — сайт работает в прежней версии. ${REASON:-Подробности — update-last.log на сервере.} Покажите это Claude."
fi
