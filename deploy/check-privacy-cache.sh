#!/usr/bin/env bash
# Проверка сохранённого результата до и после перезапуска. Git не изменяется.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.config/0110/hosts.env" ] && . "$HOME/.config/0110/hosts.env"
SERVER="${JARVIS_SERVER:?Задай JARVIS_SERVER}"
[[ ${1:-} =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && ${2:-} =~ ^[0-9]{8}-[a-z0-9]{4}$ && ${3:-} =~ ^[0-9]+$ ]] || { echo 'Нужны repo chat uid' >&2; exit 1; }
scp deploy/check-privacy-cache.ts "$SERVER:/tmp/chat0110-check-privacy-cache.ts"
trap 'ssh "$SERVER" "rm -f /tmp/chat0110-check-privacy-cache.ts"' EXIT
# Только сервер читает свой env; значения не выводятся и не копируются на Mac.
PROBE="sudo bash -c 'set -a; . /etc/chat0110/chat0110.env; set +a; exec runuser -u jarvis --preserve-environment -- /usr/local/bin/bun /tmp/chat0110-check-privacy-cache.ts $1 $2 $3"
ssh "$SERVER" "$PROBE http'"
ssh "$SERVER" "$PROBE offline'"
ssh "$SERVER" 'set -e; sudo systemctl restart chat0110; for i in $(seq 1 15); do curl -fsS http://127.0.0.1:4340/health >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
ssh "$SERVER" "$PROBE http'"
ssh "$SERVER" "$PROBE offline'"
