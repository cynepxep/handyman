#!/usr/bin/env bash
# Включить автообновление сайта на сервере (один раз): таймер systemd запускает deploy/auto-update.sh каждые 5 минут.
#   cd /opt/handyman && bash deploy/install-auto-update.sh            — включить (и сразу проверить обновления)
#   bash deploy/install-auto-update.sh --remove                       — выключить совсем
# Приостановить на время, не выключая: touch .auto-update/off (вернуть: rm .auto-update/off).
set -Eeuo pipefail

cd "$(dirname "$0")/.."
DIR="$PWD"
UNIT=handyman-auto-update

[ "$(id -u)" = 0 ] || { echo "Нужны права root: sudo bash deploy/install-auto-update.sh"; exit 1; }
command -v systemctl >/dev/null || { echo "На сервере нет systemd — автообновление этим способом не поставить."; exit 1; }

if [ "${1:-}" = "--remove" ]; then
  systemctl disable --now "$UNIT.timer" 2>/dev/null || true
  rm -f "/etc/systemd/system/$UNIT.service" "/etc/systemd/system/$UNIT.timer"
  systemctl daemon-reload
  echo "Автообновление выключено. Обновлять вручную: cd $DIR && bash deploy/update.sh"
  exit 0
fi

cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=Handyman: обновить сайт, если на GitHub новая версия
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$DIR
Environment=HOME=/root
ExecStart=/bin/bash $DIR/deploy/auto-update.sh
EOF

cat > "/etc/systemd/system/$UNIT.timer" <<EOF
[Unit]
Description=Handyman: проверять обновления сайта каждые 5 минут

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=30s

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "$UNIT.timer"
echo "Автообновление включено: каждые 5 минут сервер проверяет GitHub (ветка main) и сам обновляет сайт."
echo "Журнал: $DIR/.auto-update/log; в чат менеджеров приходит сообщение, только если обновление не удалось."
echo "Проверяю обновления сейчас…"
systemctl start "$UNIT.service" || true
tail -n 3 "$DIR/.auto-update/log" 2>/dev/null || echo "(новых версий нет — сайт уже последней версии)"
