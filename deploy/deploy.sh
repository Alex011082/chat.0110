#!/usr/bin/env bash
# Выкат chat.0110 на Jarvis. Уезжает только закоммиченное состояние: git archive
# HEAD собирается локально или на сервере и копируется в /opt/chat0110/releases/<sha>.
# Секреты в /etc/chat0110/chat0110.env выкат не трогает.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.config/0110/hosts.env" ] && . "$HOME/.config/0110/hosts.env"
SERVER="${JARVIS_SERVER:?Задай JARVIS_SERVER (например в ~/.config/0110/hosts.env)}"

# Неотслеживаемые пользовательские файлы не входят в git archive и не мешают
# выкатке; отслеживаемые изменения должны совпадать с проверенным коммитом.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Есть незакоммиченные изменения — выкатывается только закоммиченное. Закоммить или спрячь их." >&2
  exit 1
fi
SHA=$(git rev-parse --short=12 HEAD)
STAGE=$(mktemp -d)
REMOTE_STAGE=""
cleanup() {
  rm -rf "$STAGE"
  if [ -n "$REMOTE_STAGE" ]; then
    ssh "$SERVER" "rm -rf -- '$REMOTE_STAGE'" || true
  fi
}
trap cleanup EXIT
git archive HEAD | tar -x -C "$STAGE"
case "${CHAT0110_BUILD_ON_SERVER:-0}" in
  0) (cd "$STAGE" && bun install --frozen-lockfile >/dev/null && bun run build >/dev/null) ;;
  1)
    # На Mac остаются только архивирование и перенос готовых файлов.
    REMOTE_STAGE=$(ssh "$SERVER" 'mktemp -d /tmp/chat0110-build.XXXXXXXX')
    [[ "$REMOTE_STAGE" =~ ^/tmp/chat0110-build\.[A-Za-z0-9]+$ ]] || { REMOTE_STAGE=""; exit 1; }
    rsync -a --delete "$STAGE/" "$SERVER:$REMOTE_STAGE/"
    ssh "$SERVER" "cd '$REMOTE_STAGE' && nice -n 10 bun install --frozen-lockfile >/dev/null && nice -n 10 bun run build >/dev/null"
    mkdir -p "$STAGE/apps/web/dist"
    rsync -a --delete "$SERVER:$REMOTE_STAGE/apps/web/dist/" "$STAGE/apps/web/dist/"
    ;;
  *) echo 'CHAT0110_BUILD_ON_SERVER: допустимы только 0 и 1' >&2; exit 1 ;;
esac

# На сервер — только то, что нужно для запуска: сервер, протокол и собранный web.
# Внешних зависимостей у сервера нет, поэтому вместо bun install на сервере —
# одна ссылка на пакет протокола, как её сделал бы bun для workspace.
REL=/opt/chat0110/releases/$SHA
ssh "$SERVER" "sudo rm -rf $REL.incoming && sudo install -d -m 755 -o \$(id -un) $REL.incoming"
rsync -a --delete \
  --include='/package.json' --include='/apps/' --include='/apps/api/***' \
  --include='/apps/web/' --include='/apps/web/dist/***' \
  --include='/packages/' --include='/packages/chat-protocol/***' \
  --include='/deploy/' --include='/deploy/chat0110.service' --include='/deploy/preserve-downloads.py' --include='/deploy/rollback-policy.py' --include='/deploy/rollback-environment.py' --include='/deploy/check-channel-guard.ts' --include='/deploy/select-rollback.sh' \
  --exclude='*' "$STAGE/" "$SERVER:$REL.incoming/"

ssh "$SERVER" "set -euo pipefail
  sudo python3 $REL.incoming/deploy/preserve-downloads.py /opt/chat0110/current/apps/web/dist/downloads $REL.incoming/apps/web/dist/downloads
  mkdir -p $REL.incoming/node_modules/@chat0110
  ln -sfn ../../packages/chat-protocol $REL.incoming/node_modules/@chat0110/chat-protocol
  # rsync -a переносит права локальной временной папки (на Mac — 700), а сервис
  # работает от jarvis: без явных прав он не зайдёт в релиз (ловушка 23.10).
  sudo chmod -R u=rwX,go=rX $REL.incoming
  sudo chown -R root:root $REL.incoming
  # Не переключаем работающий сайт на релиз без локальной защиты данных.
  sudo -u jarvis env HF_HOME=/var/lib/chat0110/privacy-cache /var/lib/chat0110/privacy-venv/bin/python $REL.incoming/apps/api/privacy/benchmark.py
  sudo rm -rf $REL
  sudo mv $REL.incoming $REL
  PREVIOUS=\$(readlink -f /opt/chat0110/current)
  # SQLite backup учитывает WAL и не требует остановки чатов.
  sudo -u jarvis python3 -c '
import pathlib, sqlite3
root = pathlib.Path(\"/var/lib/chat0110\")
backup = root / \"backups\" / \"$SHA\"
backup.mkdir(mode=0o700, parents=True, exist_ok=True)
for path in root.glob(\"*.sqlite\"):
    with sqlite3.connect(path.as_uri() + \"?mode=ro\", uri=True) as source, sqlite3.connect(backup / path.name) as target:
        source.backup(target)
'
  sudo cp /etc/systemd/system/chat0110.service $REL/deploy/chat0110.service.previous
  if ! sudo cmp -s $REL/deploy/chat0110.service /etc/systemd/system/chat0110.service; then
    sudo install -m 644 -o root -g root $REL/deploy/chat0110.service /etc/systemd/system/chat0110.service
    sudo systemctl daemon-reload
  fi
  sudo ln -sfn $REL /opt/chat0110/.current-$SHA
  sudo mv -Tf /opt/chat0110/.current-$SHA /opt/chat0110/current
  if sudo systemctl restart chat0110; then
    for i in \$(seq 1 15); do
      curl -fsS http://127.0.0.1:4340/health >/dev/null 2>&1 && exit 0
      sleep 1
    done
  fi
  echo 'Сервис не ответил на /health за 15 с; возвращаю предыдущий релиз:' >&2
  # При неподтверждённой совместимости не открываем старый API над новой очередью.
  sudo bash $REL/deploy/select-rollback.sh $REL \$PREVIOUS /var/lib/chat0110/dispatch.sqlite || exit 1
  sudo cmp -s $REL/deploy/chat0110.service $REL/deploy/chat0110.service.previous || exit 1
  sudo install -m 644 -o root -g root $REL/deploy/chat0110.service.previous /etc/systemd/system/chat0110.service
  sudo systemctl daemon-reload
  sudo python3 $REL/deploy/rollback-environment.py /etc/chat0110/chat0110.env $REL/deploy/chat0110.service || exit 1
  sudo ln -sfn \$PREVIOUS /opt/chat0110/.rollback-$SHA
  sudo mv -Tf /opt/chat0110/.rollback-$SHA /opt/chat0110/current
  sudo systemctl restart chat0110
  sudo journalctl -u chat0110 -n 40 --no-pager >&2
  exit 1"
echo "Выкачено: $SHA → https://chat.0110.digital"
