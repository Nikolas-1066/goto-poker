#!/usr/bin/env bash
# Первичная настройка VDS (Ubuntu 22.04/24.04) под табло ГОТО ПОКЕР.
# Запускается один раз от root. Обычно его вызывает deploy/setup.sh с вашего Mac.
#
# Что делает: Node.js 22, пользователь goto, systemd-сервис, nginx,
# HTTPS (Let's Encrypt), файрвол, swap, ежедневные бэкапы базы.
set -euo pipefail

APP_DIR=/opt/goto-poker
DATA_DIR=/var/lib/goto-poker
BACKUP_DIR=/var/backups/goto-poker
ENV_FILE=/etc/goto-poker.env
APP_USER=goto
PORT=3000

[[ $EUID -eq 0 ]] || { echo "Запустите от root"; exit 1; }

ask() { # ask VAR "Вопрос" [по умолчанию]
  local var=$1 prompt=$2 def=${3:-} val
  read -r -p "$prompt${def:+ [$def]}: " val </dev/tty || true
  printf -v "$var" '%s' "${val:-$def}"
}

echo "=== Настройка сервера ГОТО ПОКЕР ==="
IP=$(curl -fsS4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
ask DOMAIN "Домен для табло (например tablo.gotopoker.ru; пусто — ${IP//./-}.sslip.io)" ""
[[ -z $DOMAIN ]] && DOMAIN="${IP//./-}.sslip.io"
ask EMAIL "E-mail для сертификата HTTPS (уведомления Let's Encrypt)" ""
if [[ -f $ENV_FILE ]] && grep -q '^ADMIN_PASSWORD=' "$ENV_FILE"; then
  echo "Пароль админки уже задан в $ENV_FILE — оставляю."
  ADMIN_PASSWORD=""
else
  while :; do
    read -r -s -p "Пароль для админки (/admin): " ADMIN_PASSWORD </dev/tty; echo
    [[ ${#ADMIN_PASSWORD} -ge 6 ]] && break
    echo "Минимум 6 символов."
  done
fi

echo "--- Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg nginx ufw certbot python3-certbot-nginx rsync >/dev/null

echo "--- Swap (сборке Next.js нужно ~1.5 ГБ памяти)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "--- Node.js 22"
if ! command -v node >/dev/null || [[ $(node -v | cut -d. -f1) != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

echo "--- Пользователь и папки"
id -u $APP_USER >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin $APP_USER
mkdir -p $APP_DIR $DATA_DIR $BACKUP_DIR
chown -R $APP_USER:$APP_USER $APP_DIR $DATA_DIR
chmod 750 $DATA_DIR

echo "--- Настройки приложения ($ENV_FILE)"
touch $ENV_FILE
chmod 640 $ENV_FILE
chown root:$APP_USER $ENV_FILE
set_env() { sed -i "/^$1=/d" $ENV_FILE; printf '%s=%s\n' "$1" "$2" >> $ENV_FILE; }
set_env NODE_ENV production
set_env DATA_DIR $DATA_DIR
set_env PORT $PORT
set_env HOSTNAME 127.0.0.1
set_env NEXT_TELEMETRY_DISABLED 1
[[ -n $ADMIN_PASSWORD ]] && set_env ADMIN_PASSWORD "$ADMIN_PASSWORD"

echo "--- Сервис systemd"
cat > /etc/systemd/system/goto-poker.service <<UNIT
[Unit]
Description=GOTO Poker tournament board
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/npm start -- -H 127.0.0.1 -p $PORT
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable goto-poker >/dev/null

echo "--- nginx"
cat > /etc/nginx/sites-available/goto-poker <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
ln -sf /etc/nginx/sites-available/goto-poker /etc/nginx/sites-enabled/goto-poker
rm -f /etc/nginx/sites-enabled/default
nginx -t -q && systemctl reload nginx

echo "--- Файрвол"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "--- HTTPS для $DOMAIN"
if [[ -n $EMAIL ]]; then MAIL_ARGS=(-m "$EMAIL"); else MAIL_ARGS=(--register-unsafely-without-email); fi
if certbot --nginx -d "$DOMAIN" --redirect --agree-tos -n "${MAIL_ARGS[@]}"; then
  SCHEME=https
else
  echo "!!! Сертификат не выпущен. Проверьте, что DNS-запись $DOMAIN указывает на $IP,"
  echo "    и повторите: certbot --nginx -d $DOMAIN --redirect"
  SCHEME=http
fi

echo "--- Ежедневный бэкап базы"
cat > /etc/cron.daily/goto-poker-backup <<'CRON'
#!/bin/sh
# Копия базы турниров, храним 60 дней
SRC=/var/lib/goto-poker/goto-poker.json
DST=/var/backups/goto-poker
[ -f "$SRC" ] && cp "$SRC" "$DST/goto-poker-$(date +%F).json"
find "$DST" -name 'goto-poker-*.json' -mtime +60 -delete
CRON
chmod 755 /etc/cron.daily/goto-poker-backup

echo "$DOMAIN" > /etc/goto-poker.domain
echo
echo "=== Сервер готов. Табло будет по адресу: $SCHEME://$DOMAIN"
echo "    Код ещё не загружен — это сделает deploy/push.sh."
