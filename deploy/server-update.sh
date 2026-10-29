#!/usr/bin/env bash
# Сборка и перезапуск после загрузки нового кода. Запускается на сервере от root.
set -euo pipefail
APP_DIR=/opt/goto-poker
cd $APP_DIR
chown -R goto:goto $APP_DIR
echo "--- Установка зависимостей"
sudo -u goto npm ci --no-audit --no-fund --loglevel=error
echo "--- Сборка"
sudo -u goto env NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build
echo "--- Перезапуск"
systemctl restart goto-poker
sleep 3
if curl -fsS -o /dev/null http://127.0.0.1:3000/api/state; then
  echo "=== Готово: https://$(cat /etc/goto-poker.domain 2>/dev/null || hostname -I | awk '{print $1}')"
else
  echo "!!! Приложение не отвечает. Логи: journalctl -u goto-poker -n 50"
  exit 1
fi
