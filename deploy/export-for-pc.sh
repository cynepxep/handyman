#!/usr/bin/env bash
# Выгрузить свежую копию с сервера в обычную папку (шаг 8.5) — чтобы скачать её на компьютер: откат на ПК (docs/LAUNCH.md, «Откат»)
# или просто держать копию у себя.
#   cd /opt/handyman && bash deploy/export-for-pc.sh            — сделать копию сейчас и выгрузить её в ~/handyman-export
#   bash deploy/export-for-pc.sh --no-new                       — не делать новую, выгрузить последнюю готовую
#   bash deploy/export-for-pc.sh --no-media                     — без фото (быстрее; фото на ПК уже есть)
# Результат: ~/handyman-export/<копия>/ (db.dump, secrets.key, manifest.json) и ~/handyman-export/media/ — их и скачивать.
# В копии — ключ шифрования и все данные магазина: после скачивания папку на сервере удалить (скрипт напомнит).
set -Eeuo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.prod.yml)
OUT="${HM_EXPORT_DIR:-$HOME/handyman-export}"
NEW=1
MEDIA=1
for a in "$@"; do
  case "$a" in
    --no-new) NEW=0 ;;
    --no-media) MEDIA=0 ;;
    *) echo "Неизвестный параметр: $a (есть --no-new, --no-media)"; exit 2 ;;
  esac
done

step() { echo; echo "==> $*"; }
fail() { echo; echo "НЕ ПОЛУЧИЛОСЬ: $*"; exit 1; }

[ -n "$("${COMPOSE[@]}" ps -q --status running web 2>/dev/null)" ] || fail "сайт не запущен (docker compose -f docker-compose.prod.yml up -d)."

if [ $NEW = 1 ]; then
  step "Делаю копию сейчас"
  "${COMPOSE[@]}" exec -T web hm backup-now || fail "копия не получилась."
fi

step "Ищу последнюю удачную копию"
# удачная копия — папка с db.dump (у неудачной его нет); имена сортируются по времени
NAME=$("${COMPOSE[@]}" exec -T web sh -c 'for d in $(ls -1 /backups | grep -E "^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}-" | sort -r); do [ -f "/backups/$d/db.dump" ] && { echo "$d"; break; }; done' | tr -d '\r')
[ -n "$NAME" ] || fail "готовых копий нет."
echo "Копия: $NAME"

step "Выгружаю в $OUT"
mkdir -p "$OUT"
chmod 700 "$OUT"
rm -rf "${OUT:?}/$NAME"
"${COMPOSE[@]}" cp "web:/backups/$NAME" "$OUT/$NAME" || fail "не удалось выгрузить копию."
if [ $MEDIA = 1 ]; then
  mkdir -p "$OUT/media"
  "${COMPOSE[@]}" cp web:/backups/media/. "$OUT/media/" || fail "не удалось выгрузить фото."
fi
echo "Размер: $(du -sh "$OUT" | cut -f1)"

echo
echo "ГОТОВО. Скачать на компьютер (в PowerShell на ПК, адрес сервера — свой):"
echo "  scp -r root@<адрес сервера>:$OUT/$NAME ."
[ $MEDIA = 1 ] && echo "  scp -r root@<адрес сервера>:$OUT/media ."
echo "После скачивания удалите выгрузку с сервера (в ней ключ шифрования): rm -rf $OUT"
