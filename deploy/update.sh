#!/usr/bin/env bash
# Обновление сайта на сервере одной командой (шаг 8.4) — аналог кнопки «Обновить сайт» на ПК владельца.
#   cd /opt/handyman && bash deploy/update.sh
# Что делает: резервная копия базы → скачивает свежую версию (git pull) → собирает образ сайта → перезапускает сайт →
# ждёт ответа /api/health → пересобирает поиск. Если новая версия не поднялась — возвращает прежний образ (сайт работает как до обновления).
# База при этом уже обновлена миграциями: они только добавляющие, прежняя версия сайта с ней работает.
# Параметры: --no-backup — без копии перед обновлением (не рекомендуется); --no-pull — не скачивать (собрать то, что в папке).
# Журнал последнего запуска — update-last.log в папке проекта.
set -Eeuo pipefail

cd "$(dirname "$0")/.."
LOG="$PWD/update-last.log"
exec > >(tee "$LOG") 2>&1

COMPOSE=(docker compose -f docker-compose.prod.yml)
IMAGE=handyman-web
BACKUP=1
PULL=1
for a in "$@"; do
  case "$a" in
    --no-backup) BACKUP=0 ;;
    --no-pull) PULL=0 ;;
    *) echo "Неизвестный параметр: $a (есть --no-backup, --no-pull)"; exit 2 ;;
  esac
done

step() { echo; echo "==> $*"; }
fail() {
  echo
  echo "НЕ ПОЛУЧИЛОСЬ: $*"
  echo "Подробности — в файле $LOG (его можно показать Claude)."
  exit 1
}
web_running() { [ -n "$("${COMPOSE[@]}" ps -q --status running web 2>/dev/null)" ]; }
# Ждать, пока сайт ответит «ok» (до $1 секунд). Проверка изнутри контейнера — не нужен curl на сервере.
wait_healthy() {
  local until=$((SECONDS + $1)) out
  while [ $SECONDS -lt $until ]; do
    out=$("${COMPOSE[@]}" exec -T web wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null || true)
    if [[ "$out" == *'"status":"ok"'* ]]; then return 0; fi
    sleep 3
  done
  return 1
}

step "Проверяю настройки"
command -v docker >/dev/null || fail "не найден Docker."
[ -f .env ] || fail "в папке проекта нет файла .env (шаблон — .env.production.example, см. deploy/README.md)."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  fail "в папке проекта есть изменённые файлы (список выше). Ничего не трогаю — покажите это Claude."
fi

if [ $BACKUP = 1 ]; then
  step "Делаю резервную копию перед обновлением"
  if web_running; then
    "${COMPOSE[@]}" exec -T web hm backup-now || fail "копия не получилась — обновление остановлено, сайт работает как раньше. Без копии: bash deploy/update.sh --no-backup"
  else
    echo "Сайт не запущен — копию пропускаю (первый запуск?)."
  fi
fi

PREV_COMMIT=$(git rev-parse --short HEAD)
if [ $PULL = 1 ]; then
  step "Скачиваю свежую версию"
  git pull --ff-only || fail "не удалось скачать обновление (нет интернета, нет доступа к GitHub или на сервере свои правки)."
fi
echo "Версия: $(git log -1 --format='%h %s') (была $PREV_COMMIT)"

step "Собираю новую версию сайта (несколько минут; сайт пока работает)"
# прежний образ — на случай отката
if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then docker tag "$IMAGE:latest" "$IMAGE:previous"; fi
# Постоянный ключ действий сайта: с ним кнопки на страницах, открытых до обновления («В кошик», «Оформити»), работают и после него.
# Создаётся один раз; потеря файла не страшна — следующая сборка сделает новый (сломаются только вкладки, открытые до неё).
ACTIONS_KEY=.data/next-actions.key
if [ ! -s "$ACTIONS_KEY" ]; then
  mkdir -p .data
  (umask 077; head -c 32 /dev/urandom | base64 > "$ACTIONS_KEY") || echo "Ключ действий не создан — сборка без него (как раньше)."
fi
if [ -s "$ACTIONS_KEY" ]; then
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(tr -d '[:space:]' < "$ACTIONS_KEY")
  export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
fi
"${COMPOSE[@]}" build web || fail "сборка не удалась — сайт продолжает работать в прежней версии."

step "Перезапускаю сайт (база обновится сама при запуске)"
"${COMPOSE[@]}" up -d --remove-orphans || fail "не удалось запустить контейнеры."

step "Жду, пока сайт ответит (до 5 минут)"
if ! wait_healthy 300; then
  echo "Новая версия не отвечает. Последние строки журнала сайта:"
  "${COMPOSE[@]}" logs --tail 60 web || true
  if docker image inspect "$IMAGE:previous" >/dev/null 2>&1; then
    step "Возвращаю прежнюю версию"
    docker tag "$IMAGE:previous" "$IMAGE:latest"
    "${COMPOSE[@]}" up -d --no-build web || true
    if wait_healthy 300; then
      fail "новая версия ($(git log -1 --format=%h)) не запустилась — вернул прежнюю, сайт работает. Файлы в папке — новой версии: следующий запуск update.sh соберёт их снова."
    fi
  fi
  fail "сайт не отвечает. Посмотрите журнал: docker compose -f docker-compose.prod.yml logs --tail 200 web"
fi

step "Обновляю поиск"
"${COMPOSE[@]}" exec -T web hm reindex || echo "Поиск обновить не удалось — сайт работает, поиск можно пересобрать позже: docker compose -f docker-compose.prod.yml exec web hm reindex"

step "Убираю старые образы"
docker image prune -f >/dev/null || true

echo
echo "ГОТОВО. Сайт обновлён и работает: $(git log -1 --format='%h %s')"
