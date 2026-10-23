#!/usr/bin/env bash
# Секреты chat.0110 на сервер. Запускает владелец сам: значения вводятся скрыто
# и уходят по SSH через stdin — их нет ни в истории shell, ни в аргументах процессов.
#
# Ключ cookie и секрет вебхука создаются один раз и при повторном запуске не
# меняются: смена ключа выкидывает всех из системы, смена секрета требует
# заново вставлять его в GitHub App. Новый секрет вебхука: --new-webhook-secret.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.config/0110/hosts.env" ] && . "$HOME/.config/0110/hosts.env"
SERVER="${JARVIS_SERVER:?Задай JARVIS_SERVER (например в ~/.config/0110/hosts.env)}"
NEW_WEBHOOK=0
[ "${1:-}" = "--new-webhook-secret" ] && NEW_WEBHOOK=1

read -r -p "GitHub App · Client ID: " CLIENT_ID
read -r -s -p "GitHub App · Client secret (ввод не виден): " CLIENT_SECRET; echo
read -r -p "GitHub App · slug (из адреса github.com/apps/<slug>): " SLUG
read -r -p "Кому можно входить — логины через запятую, * — всем [Alex011082]: " ALLOWED
ALLOWED=${ALLOWED:-Alex011082}

for v in "$CLIENT_ID" "$CLIENT_SECRET" "$SLUG" "$ALLOWED"; do
  if [ -z "$v" ] || [[ "$v" =~ [[:space:]\"\'\\\$\`] ]]; then
    echo "Пустое значение или недопустимые символы (пробелы, кавычки, \$, \\, \`)." >&2
    exit 1
  fi
done

# Скрипт для сервера. Секретов в нём нет — они придут в stdin, — поэтому его
# можно передать аргументом (в base64, чтобы не воевать с кавычками).
read -r -d '' REMOTE <<'SCRIPT' || true
set -euo pipefail
env_file=/etc/chat0110/chat0110.env
input=$(cat)
old() { sudo sed -n "s/^$1=//p" "$env_file" 2>/dev/null || true; }
key=$(old CHAT0110_COOKIE_KEY)
[ -n "$key" ] || key=$(openssl rand -hex 32)
hook=$(old GITHUB_WEBHOOK_SECRET)
status=kept
if [ -z "$hook" ] || [ "$NEW_WEBHOOK" = 1 ]; then
  status=new
  hook=$(openssl rand -hex 32)
fi
tmp=$(sudo mktemp /etc/chat0110/.env.XXXXXX)
{
  printf '%s\n' "$input"
  echo "GITHUB_WEBHOOK_SECRET=$hook"
  echo "CHAT0110_COOKIE_KEY=$key"
} | sudo tee "$tmp" >/dev/null
sudo chmod 600 "$tmp"
sudo mv "$tmp" "$env_file"
sudo systemctl restart chat0110 2>/dev/null || true
# Новый секрет нужен владельцу, чтобы вставить его в GitHub App.
if [ "$status" = new ]; then echo "new $hook"; else echo kept; fi
SCRIPT
B64=$(printf '%s' "$REMOTE" | base64 | tr -d '\n')

RESULT=$(printf '%s\n' \
  "GITHUB_APP_CLIENT_ID=$CLIENT_ID" \
  "GITHUB_APP_CLIENT_SECRET=$CLIENT_SECRET" \
  "GITHUB_APP_SLUG=$SLUG" \
  "CHAT0110_ALLOWED_LOGINS=$ALLOWED" |
  ssh "$SERVER" "NEW_WEBHOOK=$NEW_WEBHOOK bash -c \"\$(echo $B64 | base64 -d)\"")

echo "Секреты записаны в /etc/chat0110/chat0110.env, сервис перезапущен."
case "$RESULT" in
  new\ *)
    echo
    echo "Секрет вебхука — вставь в GitHub App → General → Webhook secret. Больше он не покажется:"
    echo "${RESULT#new }"
    ;;
  *)
    echo "Секрет вебхука прежний (новый: bash deploy/configure.sh --new-webhook-secret)."
    ;;
esac
