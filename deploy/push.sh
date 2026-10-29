#!/usr/bin/env bash
# Выкатить текущую версию с Mac на сервер: ./deploy/push.sh root@IP
# Адрес можно сохранить в deploy/.host, тогда достаточно ./deploy/push.sh
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${1:-$(cat deploy/.host 2>/dev/null || true)}
[[ -n $HOST ]] || { echo "Укажите сервер: ./deploy/push.sh root@IP"; exit 1; }
echo "$HOST" > deploy/.host

echo "--- Загрузка кода на $HOST"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git --exclude data \
  --exclude '.env*' --exclude 'Claude outputs' --exclude deploy/.host --exclude deploy/.cache --exclude dist --exclude .DS_Store \
  ./ "$HOST":/opt/goto-poker/
ssh "$HOST" "bash /opt/goto-poker/deploy/server-update.sh"
