#!/usr/bin/env bash
# Собрать пакет табло для ноутбука на Windows (запускать на Mac в папке проекта):
#   ./deploy/build-windows.sh
# Результат: dist/GOTO-Poker-Windows.zip — его копируете на ноутбук (флешка/Telegram).
# Внутри уже есть node.exe, на ноутбуке ничего устанавливать не нужно.
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_DIST=${NODE_DIST:-latest-v22.x}
OUT=dist/GOTO-Poker
SYS=$OUT/system
CACHE=deploy/.cache

echo "--- Сборка приложения (standalone)"
rm -rf .next
BUILD_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1 npm run build

echo "--- Сборка пакета"
rm -rf dist
mkdir -p "$SYS/scripts"
# -L: заменить симлинки настоящими файлами (в zip для Windows они не работают)
cp -RL .next/standalone "$SYS/app"
mkdir -p "$SYS/app/.next"
cp -R .next/static "$SYS/app/.next/static"
[ -d public ] && cp -R public "$SYS/app/public"
# Лишнее: локальная база разработчика и нативные модули картинок (не используются)
rm -rf "$SYS/app/data" "$SYS/app/.env"* "$SYS/app/node_modules/sharp" "$SYS/app/node_modules/@img" "$SYS/app/deploy" "$SYS/app/dist"

NATIVE=$(find "$SYS/app" -name '*.node' | head -5 || true)
if [ -n "$NATIVE" ]; then
  echo "!!! Внимание: в сборке есть нативные модули, на Windows они могут не работать:"
  echo "$NATIVE"
fi

echo "--- Node.js для Windows ($NODE_DIST)"
mkdir -p "$CACHE"
SUMS=$(curl -fsSL "https://nodejs.org/dist/$NODE_DIST/SHASUMS256.txt")
NODE_ZIP=$(echo "$SUMS" | awk '/win-x64\.zip$/ {print $2}')
NODE_SUM=$(echo "$SUMS" | awk '/win-x64\.zip$/ {print $1}')
if [ ! -f "$CACHE/$NODE_ZIP" ]; then
  curl -fL --progress-bar -o "$CACHE/$NODE_ZIP" "https://nodejs.org/dist/$NODE_DIST/$NODE_ZIP"
fi
echo "$NODE_SUM  $CACHE/$NODE_ZIP" | shasum -a 256 -c - >/dev/null || { rm -f "$CACHE/$NODE_ZIP"; echo "Контрольная сумма Node.js не совпала"; exit 1; }
unzip -q -j -o "$CACHE/$NODE_ZIP" '*/node.exe' -d "$SYS"

echo "--- Скрипты запуска"
cp deploy/windows/INSTALL.bat deploy/windows/START.bat deploy/windows/STOP.bat deploy/windows/FIX-FIREWALL.bat deploy/windows/DIAGNOSE.bat "$OUT/"
cp deploy/windows/goto.ico "$SYS/"
# .ps1 и инструкция: UTF-8 с BOM + переводы строк Windows (иначе кириллица ломается)
for f in deploy/windows/scripts/*.ps1; do
  { printf '\xEF\xBB\xBF'; perl -pe 's/\r?\n/\r\n/' "$f"; } > "$SYS/scripts/$(basename "$f")"
done
{ printf '\xEF\xBB\xBF'; perl -pe 's/\r?\n/\r\n/' deploy/windows/README-RU.txt; } > "$OUT/README-RU.txt"

echo "--- Архив"
(cd dist && zip -qr -X GOTO-Poker-Windows.zip GOTO-Poker)
SIZE=$(du -h dist/GOTO-Poker-Windows.zip | cut -f1)
echo
echo "=== Готово: dist/GOTO-Poker-Windows.zip ($SIZE)"
echo "    Скопируйте его на ноутбук, распакуйте и запустите INSTALL.bat."
echo "    Инструкция для бара — README-RU.txt внутри архива."
open dist 2>/dev/null || true
