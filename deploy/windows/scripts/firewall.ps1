# Открыть доступ к табло для телефонов (файрвол Windows). Запускается с правами администратора.
. (Join-Path $PSScriptRoot 'common.ps1')
$Host.UI.RawUI.WindowTitle = 'ГОТО ПОКЕР — доступ для телефонов'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    exit
}

Write-Title '♠ ГОТО ПОКЕР — открываю доступ для телефонов'
$cfg = Read-Settings
if (Repair-Firewall $cfg.PORT) {
    Write-Host '  ✓ Готово: телефоны в Wi-Fi клуба могут открыть админку.' -ForegroundColor Green
    Start-Sleep -Seconds 3
} else {
    Write-Host "  ОШИБКА: правило не создалось. Отчёт: $LogDir\firewall.log" -ForegroundColor Red
    Read-Host '  Нажмите Enter, чтобы закрыть'
}
