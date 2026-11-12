#!/bin/zsh
# Собрать пакет табло для Windows: dist/GOTO-Poker-v<версия>.zip
# Запуск в Терминале:  cd ~/Projects/goto-poker && bash build-windows.command
cd "$(dirname "$0")"
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
{
  echo "start $(date)"
  bash ./deploy/build-windows.sh
  echo "EXIT=$?"
} 2>&1 | tee build-windows.log
echo; echo "Готово — окно можно закрыть."
