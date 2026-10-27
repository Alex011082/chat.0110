#!/usr/bin/env bash
# Однократная установка CPU-модели. Не перезапускает приложение и не меняет секреты.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.config/0110/hosts.env" ] && . "$HOME/.config/0110/hosts.env"
SERVER="${JARVIS_SERVER:?Задай JARVIS_SERVER}"
scp apps/api/privacy/requirements.txt apps/api/privacy/provision.py "$SERVER:/tmp/"
ssh "$SERVER" 'set -euo pipefail
  sudo install -d -m 700 -o jarvis -g jarvis /var/lib/chat0110
  sudo -u jarvis python3 -m venv /var/lib/chat0110/privacy-venv
  sudo -u jarvis /var/lib/chat0110/privacy-venv/bin/pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.14.1
  sudo -u jarvis /var/lib/chat0110/privacy-venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
  sudo -u jarvis env HF_HOME=/var/lib/chat0110/privacy-cache /var/lib/chat0110/privacy-venv/bin/python /tmp/provision.py
  rm /tmp/requirements.txt /tmp/provision.py'
