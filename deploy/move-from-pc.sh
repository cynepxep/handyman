#!/usr/bin/env bash
# Переезд с ПК на сервер (шаг 8.5): загрузить резервную копию с компьютера владельца в сайт на сервере одной командой.
#   cd /opt/handyman && bash deploy/move-from-pc.sh ~/transfer/2026-10-05_120000-manual
# Рядом с папкой копии может лежать папка media (фото из копий ПК) — её фото тоже переносятся.
# Что делает: проверяет копию → ключ шифрования (SECRETS_KEY в .env: пусто — впишет из копии; другой — остановится) →
# кладёт копию и фото в том копий → останавливает сайт → восстанавливает базу (перед этим — копия текущей) → запускает сайт →
# ждёт ответа /api/health → пересобирает поиск. Пошагово для владельца — docs/LAUNCH.md. Журнал — move-last.log в папке проекта.
# Параметр --yes — не спрашивать подтверждение (для проверок).
set -Eeuo pipefail

cd "$(dirname "$0")/.."
LOG="$PWD/move-last.log"
exec > >(tee "$LOG") 2>&1

COMPOSE=(docker compose -f docker-compose.prod.yml)
SRC=""
YES=0
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    -*) echo "Неизвестный параметр: $a (есть --yes)"; exit 2 ;;
    *) SRC="$a" ;;
  esac
done

step() { echo; echo "==> $*"; }
fail() {
  echo
  echo "НЕ ПОЛУЧИЛОСЬ: $*"
  echo "Подробности — в файле $LOG (его можно показать Claude)."
  exit 1
}
wait_healthy() {
  local until=$((SECONDS + $1)) out
  while [ $SECONDS -lt $until ]; do
    out=$("${COMPOSE[@]}" exec -T web wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null || true)
    if [[ "$out" == *'"status":"ok"'* ]]; then return 0; fi
    sleep 3
  done
  return 1
}
# значение переменной из .env (без кавычек); пусто — если нет
env_value() { sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }

step "Проверяю копию"
[ -n "$SRC" ] || fail "укажите папку копии: bash deploy/move-from-pc.sh ~/transfer/<имя копии>"
SRC="${SRC%/}"
[ -d "$SRC" ] || fail "папки $SRC нет."
for f in db.dump manifest.json; do [ -f "$SRC/$f" ] || fail "в $SRC нет файла $f — это не папка резервной копии (нужна папка вида 2026-10-05_120000-manual)."; done
NAME=$(basename "$SRC")
[[ "$NAME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}-[a-z-]+$ ]] || fail "имя папки $NAME не похоже на копию (2026-10-05_120000-manual). Не переименовывайте папку копии."
MEDIA="$(dirname "$SRC")/media"
echo "Копия: $NAME ($(du -sh "$SRC" | cut -f1))"
if [ -d "$MEDIA" ]; then echo "Фото: $MEDIA ($(find "$MEDIA" -type f | wc -l) файлов, $(du -sh "$MEDIA" | cut -f1))"; else echo "Папки media рядом с копией нет — фото не переносятся (их можно докопировать позже тем же способом)."; fi

step "Проверяю ключ шифрования"
[ -f .env ] || fail "в папке проекта нет файла .env (шаблон — .env.production.example, docs/LAUNCH.md)."
KEY_FILE="$SRC/secrets.key"
if [ -f "$KEY_FILE" ]; then
  KEY=$(tr -d '\r\n' < "$KEY_FILE")
  CUR=$(env_value SECRETS_KEY)
  if [ -z "$CUR" ]; then
    ESC=$(printf '%s' "$KEY" | sed -e 's/[\\/&|]/\\&/g')
    if grep -q '^SECRETS_KEY=' .env; then sed -i "s|^SECRETS_KEY=.*|SECRETS_KEY=$ESC|" .env; else printf '\nSECRETS_KEY=%s\n' "$KEY" >> .env; fi
    echo "SECRETS_KEY в .env был пустой — вписан ключ из копии (тот же, что на ПК)."
  elif [ "$CUR" = "$KEY" ]; then
    echo "SECRETS_KEY в .env совпадает с ключом копии."
  else
    fail "SECRETS_KEY в .env не совпадает с ключом из копии — с ним ключи «Интеграций» из базы ПК не расшифровать. Уберите значение (оставьте «SECRETS_KEY=») и запустите снова: скрипт впишет ключ из копии."
  fi
else
  echo "В копии нет secrets.key — ключи «Интеграций» придётся вписать заново."
fi

if [ $YES = 0 ]; then
  echo
  echo "ВНИМАНИЕ: всё, что сейчас в базе на сервере, заменится данными копии $NAME (перед этим сайт сам сделает копию текущей базы)."
  read -r -p "Продолжить? Напишите да и нажмите Enter: " answer
  [ "$answer" = "да" ] || fail "отменено — ничего не менялось."
fi

step "Запускаю базу, поиск и сайт (если ещё не запущены)"
# up -d пересоздаёт сайт, если поменялся .env (ключ шифрования)
"${COMPOSE[@]}" up -d --no-build || fail "не удалось запустить контейнеры (образ сайта ещё не собран? docker compose -f docker-compose.prod.yml up -d --build)."
wait_healthy 300 || fail "сайт не отвечает. Журнал: docker compose -f docker-compose.prod.yml logs --tail 200 web"

step "Кладу копию в хранилище копий на сервере"
"${COMPOSE[@]}" exec -T -u 0 web sh -c "rm -rf '/backups/$NAME' && mkdir -p /backups/media" || fail "не удалось подготовить папку копий."
"${COMPOSE[@]}" cp "$SRC" "web:/backups/$NAME" || fail "не удалось скопировать копию."
if [ -d "$MEDIA" ]; then "${COMPOSE[@]}" cp "$MEDIA/." web:/backups/media/ || fail "не удалось скопировать фото."; fi
"${COMPOSE[@]}" exec -T -u 0 web chown -R handyman:handyman "/backups/$NAME" /backups/media || fail "не удалось выставить права на копию."

step "Останавливаю сайт и восстанавливаю базу"
"${COMPOSE[@]}" stop web
if ! "${COMPOSE[@]}" run --rm -T web backup-restore "$NAME" --yes; then
  "${COMPOSE[@]}" up -d web || true
  fail "восстановление не удалось — сайт запущен снова с прежней базой."
fi

step "Запускаю сайт (база обновится до текущей версии сама)"
"${COMPOSE[@]}" up -d web || fail "не удалось запустить сайт."
wait_healthy 300 || fail "сайт не отвечает после восстановления. Журнал: docker compose -f docker-compose.prod.yml logs --tail 200 web"

step "Пересобираю поиск по перенесённым товарам"
"${COMPOSE[@]}" exec -T web hm reindex || echo "Поиск пересобрать не удалось — сайт работает; повторить: docker compose -f docker-compose.prod.yml exec web hm reindex"

echo
echo "ГОТОВО. Данные с ПК перенесены (копия $NAME). Дальше — docs/LAUNCH.md, шаг «Проверка после переноса»."
