#!/usr/bin/env bash
# Настройка сервера Jarvis под chat.0110: каталоги, systemd-unit, сайт Caddy.
# Запуск с локальной машины: bash deploy/setup.sh. Повторный запуск безопасен.
#
# Ловушка из передачи Jarvis 15.09: выкаты Jarvis дважды стирали сайты соседей,
# а битый файл в /etc/caddy при `admin off` роняет Caddy целиком — вместе с
# Творцом и pmstudio. Поэтому трогаем только свой chat0110.caddy, проверяем весь
# конфиг до перезапуска и откатываем свой файл, если проверка не прошла.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.config/0110/hosts.env" ] && . "$HOME/.config/0110/hosts.env"
SERVER="${JARVIS_SERVER:?Задай JARVIS_SERVER (например в ~/.config/0110/hosts.env)}"

TMP=$(ssh "$SERVER" mktemp -d)
scp -q deploy/chat0110.service deploy/chat0110.caddy "$SERVER:$TMP/"

ssh "$SERVER" "set -euo pipefail
  trap 'rm -rf $TMP' EXIT
  sudo install -d -m 755 -o root -g root /opt/chat0110 /opt/chat0110/releases
  sudo install -d -m 700 -o root -g root /etc/chat0110

  sudo install -m 644 -o root -g root $TMP/chat0110.service /etc/systemd/system/chat0110.service
  sudo systemctl daemon-reload
  sudo systemctl enable chat0110 >/dev/null 2>&1

  if sudo cmp -s $TMP/chat0110.caddy /etc/caddy/chat0110.caddy; then
    echo 'Сайт Caddy не изменился — Caddy не перезапускаю'
    exit 0
  fi
  backup=\$(mktemp)
  had_old=0
  if sudo test -f /etc/caddy/chat0110.caddy; then sudo cp /etc/caddy/chat0110.caddy \$backup; had_old=1; fi
  sudo install -m 644 -o root -g root $TMP/chat0110.caddy /etc/caddy/chat0110.caddy
  if ! sudo -u caddy /usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>\$backup.err; then
    if [ \$had_old = 1 ]; then sudo install -m 644 -o root -g root \$backup /etc/caddy/chat0110.caddy; else sudo rm -f /etc/caddy/chat0110.caddy; fi
    cat \$backup.err >&2
    echo 'Caddy не принял конфиг: chat0110.caddy откатан, Caddy не перезапускался' >&2
    exit 1
  fi
  sudo systemctl restart caddy
  echo 'Сайт chat.0110.digital подключён, Caddy перезапущен'"
