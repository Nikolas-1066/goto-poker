#!/usr/bin/env bash
# Первый запуск с Mac: ./deploy/setup.sh root@IP_СЕРВЕРА
# 1) настраивает вход по ключу, 2) настраивает сервер, 3) загружает код.
set -euo pipefail
HOST=${1:?"Укажите сервер: ./deploy/setup.sh root@IP"}
cd "$(dirname "$0")/.."

if [[ ! -f ~/.ssh/id_ed25519.pub && ! -f ~/.ssh/id_rsa.pub ]]; then
  echo "--- Создаю SSH-ключ на этом Mac"
  ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
fi
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" true 2>/dev/null; then
  echo "--- Добавляю ключ на сервер (введите пароль root из панели Timeweb)"
  ssh-copy-id -o StrictHostKeyChecking=accept-new "$HOST"
fi

scp -q deploy/server-setup.sh "$HOST":/root/goto-server-setup.sh
ssh -t "$HOST" "bash /root/goto-server-setup.sh"
./deploy/push.sh "$HOST"
