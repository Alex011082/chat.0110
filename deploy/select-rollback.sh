#!/usr/bin/env bash
# Сначала закрываем приём: проверка БД до stop оставляла бы гонку с последним переносом.
set -euo pipefail
checker_root="${1:?Нужен каталог проверенного guard}"
target="${2:?Нужен каталог кандидата}"
database="${3:?Нужна база очереди}"
sudo systemctl stop chat0110
sudo python3 "$checker_root/deploy/rollback-environment.py" "${4:-/etc/chat0110/chat0110.env}" || exit 3
if ! sudo cmp -s "$checker_root/deploy/chat0110.service" "$target/deploy/chat0110.service"; then
  echo 'Unit кандидата не подтверждён: сервис остаётся остановленным' >&2
  exit 3
fi
policy=0
sudo python3 "$checker_root/deploy/rollback-policy.py" "$database" || policy=$?
case "$policy" in
  0) exit 0 ;;
  2) ;; # Очередь подтверждена, но требует нового API.
  *) echo 'Очередь не подтверждена: сервис остаётся остановленным' >&2; exit 3 ;;
esac
if sudo -u jarvis bun "$checker_root/deploy/check-channel-guard.ts" "$target" --synthetic >/dev/null; then
  exit 0
fi
echo 'Кандидат несовместим: сервис и доставка оставлены закрытыми; очередь не восстанавливалась и не менялась' >&2
exit 2
