# Забыли пароль владельца (раздел «Статистика» и правила рейтинга): сбросить его.
# Кладёт в папку data файл-сброс; при следующем открытии «Статистики» пароль сбрасывается
# и его можно придумать заново. Данные турниров не трогаются.
. (Join-Path $PSScriptRoot 'common.ps1')
$Host.UI.RawUI.WindowTitle = 'ГОТО ПОКЕР — сброс пароля владельца'

Write-Title '♠ ГОТО ПОКЕР — сброс пароля владельца'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
Set-Content -Path (Join-Path $DataDir 'reset-owner-password.txt') -Value 'reset'
Write-Host '  Готово. Откройте в админке «Статистику» и придумайте новый пароль владельца.' -ForegroundColor Green
Write-Host '  Пароль админки и данные турниров не изменились.'
Start-Sleep -Seconds 6
