#!/usr/bin/env bash
# Только явный откат к сохранённому релизу. База, секреты и чужие сайты не меняются.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.config/0110/hosts.env" ] && . "$HOME/.config/0110/hosts.env"
SERVER="${JARVIS_SERVER:?Задай JARVIS_SERVER}"
SHA="${1:?Нужен точный 12-символьный SHA сохранённого релиза}"
[[ "$SHA" =~ ^[0-9a-f]{12}$ ]] || { echo 'Неверный SHA' >&2; exit 1; }
ssh "$SERVER" bash -s -- "$SHA" <<'REMOTE'
set -euo pipefail
target="/opt/chat0110/releases/$1"
[ -d "$target" ] && [ -f "$target/deploy/chat0110.service" ]
previous=$(readlink -f /opt/chat0110/current)
service_copy=$(mktemp)
trap 'rm -f "$service_copy"' EXIT
sudo cat /etc/systemd/system/chat0110.service > "$service_copy"
switch_to() {
  sudo ln -sfn "$1" /opt/chat0110/.rollback-current
  sudo mv -Tf /opt/chat0110/.rollback-current /opt/chat0110/current
}
sudo install -m 644 -o root -g root "$target/deploy/chat0110.service" /etc/systemd/system/chat0110.service
sudo systemctl daemon-reload
switch_to "$target"
if sudo systemctl restart chat0110; then
  for i in $(seq 1 15); do
    if curl -fsS http://127.0.0.1:4340/health >/dev/null 2>&1; then
      echo 'Сохранённый релиз активен; база и секреты сохранены'
      exit 0
    fi
    sleep 1
  done
fi
# Не оставляем оператора с ещё одним неработающим релизом при неудачном откате.
sudo install -m 644 -o root -g root "$service_copy" /etc/systemd/system/chat0110.service
sudo systemctl daemon-reload
switch_to "$previous"
sudo systemctl restart chat0110
echo 'Откат не прошёл health; возвращён исходный указатель релиза' >&2
exit 1
REMOTE
