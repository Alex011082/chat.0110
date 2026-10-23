#!/usr/bin/env bash
# Выкат chat.0110 на Jarvis. Уезжает только закоммиченное состояние: git archive
# HEAD собирается локально (web) и копируется в /opt/chat0110/releases/<sha>.
# Секреты в /etc/chat0110/chat0110.env выкат не трогает.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.config/0110/hosts.env" ] && . "$HOME/.config/0110/hosts.env"
SERVER="${JARVIS_SERVER:?Задай JARVIS_SERVER (например в ~/.config/0110/hosts.env)}"

if [ -n "$(git status --porcelain)" ]; then
  echo "Есть незакоммиченные изменения — выкатывается только закоммиченное. Закоммить или спрячь их." >&2
  exit 1
fi
SHA=$(git rev-parse --short=12 HEAD)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
git archive HEAD | tar -x -C "$STAGE"
(cd "$STAGE" && bun install --frozen-lockfile >/dev/null && bun run build >/dev/null)

# На сервер — только то, что нужно для запуска: сервер, протокол и собранный web.
# Внешних зависимостей у сервера нет, поэтому вместо bun install на сервере —
# одна ссылка на пакет протокола, как её сделал бы bun для workspace.
REL=/opt/chat0110/releases/$SHA
ssh "$SERVER" "sudo rm -rf $REL.incoming && sudo install -d -m 755 -o \$(id -un) $REL.incoming"
rsync -a --delete \
  --include='/package.json' --include='/apps/' --include='/apps/api/***' \
  --include='/apps/web/' --include='/apps/web/dist/***' \
  --include='/packages/' --include='/packages/chat-protocol/***' \
  --exclude='*' "$STAGE/" "$SERVER:$REL.incoming/"

ssh "$SERVER" "set -euo pipefail
  mkdir -p $REL.incoming/node_modules/@chat0110
  ln -sfn ../../packages/chat-protocol $REL.incoming/node_modules/@chat0110/chat-protocol
  # rsync -a переносит права локальной временной папки (на Mac — 700), а сервис
  # работает от jarvis: без явных прав он не зайдёт в релиз (ловушка 23.10).
  sudo chmod -R u=rwX,go=rX $REL.incoming
  sudo chown -R root:root $REL.incoming
  sudo rm -rf $REL
  sudo mv $REL.incoming $REL
  sudo ln -sfn $REL /opt/chat0110/.current-$SHA
  sudo mv -Tf /opt/chat0110/.current-$SHA /opt/chat0110/current
  sudo systemctl restart chat0110
  cd /opt/chat0110/releases && ls -1t | tail -n +6 | xargs -r sudo rm -rf
  for i in \$(seq 1 15); do
    curl -fsS http://127.0.0.1:4340/health >/dev/null 2>&1 && exit 0
    sleep 1
  done
  echo 'Сервис не ответил на /health за 15 с:' >&2
  sudo journalctl -u chat0110 -n 40 --no-pager >&2
  exit 1"
echo "Выкачено: $SHA → https://chat.0110.digital"
