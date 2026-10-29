# Выключить табло: закрыть окно на телевизоре и остановить сервер
. (Join-Path $PSScriptRoot 'common.ps1')
$Host.UI.RawUI.WindowTitle = 'ГОТО ПОКЕР — выключение'

Write-Title '♠ ГОТО ПОКЕР — выключение табло'
Stop-Kiosk
Stop-Server
Write-Host '  Табло выключено. Данные турнира сохранены.' -ForegroundColor Green
Start-Sleep -Seconds 3
