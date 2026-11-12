#!/usr/bin/env bash
# Собрать пакет табло для ноутбука на Windows (запускать на Mac в папке проекта):
#   ./deploy/build-windows.sh
# Результат: dist/GOTO-Poker-v1.N.zip — его копируете на ноутбук (флешка/Telegram).
# Версия: deploy/VERSION хранит последнюю собранную (например, 1.4); каждая сборка прибавляет 1
# к последнему числу (1.5, 1.6…). Новую «большую» версию задают при сборке:
#   BUILD_VERSION=2.0 ./deploy/build-windows.sh   → соберётся ровно 2.0, следующие — 2.1, 2.2…
# Внутри уже есть node.exe, на ноутбуке ничего устанавливать не нужно.
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_DIST=${NODE_DIST:-latest-v22.x}
OUT=dist/GOTO-Poker
SYS=$OUT/system
CACHE=deploy/.cache

# Версия: видна внизу табло, в названии архива и в окне обновления
LAST=$(tr -d ' \r\n' < deploy/VERSION 2>/dev/null || echo "1.0")
VERSION="${BUILD_VERSION:-${LAST%.*}.$(( ${LAST##*.} + 1 ))}"
if ! [[ $VERSION =~ ^[0-9]+\.[0-9]+$ ]]; then echo "Версия должна быть вида 2.0, а не «$VERSION»"; exit 1; fi
BUILD_DATE=$(date '+%d.%m.%Y %H:%M')
ZIP="GOTO-Poker-v$VERSION.zip"

echo "--- Сборка приложения (standalone), версия $VERSION"
rm -rf .next
BUILD_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BUILD_LABEL="$VERSION" npm run build

echo "--- Сборка пакета"
# старые архивы версий не трогаем — можно откатиться
rm -rf "$OUT" "dist/$ZIP"
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
cp deploy/windows/INSTALL.bat deploy/windows/UPDATE.bat deploy/windows/START.bat deploy/windows/STOP.bat deploy/windows/FIX-FIREWALL.bat deploy/windows/DIAGNOSE.bat deploy/windows/RESET-OWNER-PASSWORD.bat "$OUT/"
cp deploy/windows/goto.ico "$SYS/"
cp deploy/windows/scripts/*.cjs "$SYS/scripts/"
printf '%s\r\n%s\r\n' "$VERSION" "$BUILD_DATE" > "$SYS/VERSION.txt"
# .ps1 и инструкция: UTF-8 с BOM + переводы строк Windows (иначе кириллица ломается)
for f in deploy/windows/scripts/*.ps1; do
  { printf '\xEF\xBB\xBF'; perl -pe 's/\r?\n/\r\n/' "$f"; } > "$SYS/scripts/$(basename "$f")"
done
{ printf '\xEF\xBB\xBF'; perl -pe 's/\r?\n/\r\n/' deploy/windows/README-RU.txt; } > "$OUT/README-RU.txt"

echo "--- Архив"
(cd dist && zip -qr -X "$ZIP" GOTO-Poker -x '*.DS_Store')
# сборка удалась — запоминаем версию
printf '%s\n' "$VERSION" > deploy/VERSION
SIZE=$(du -h "dist/$ZIP" | cut -f1)
echo
echo "=== Готово: dist/$ZIP ($SIZE), версия $VERSION"
echo "    Перенесите его на ноутбук, «Извлечь всё» и запустите UPDATE.bat."
echo "    Инструкция для бара — README-RU.txt внутри архива."
open dist 2>/dev/null || true
