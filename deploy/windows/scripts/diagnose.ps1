# Диагностика: почему телефон не открывает табло. Создаёт отчёт на рабочем столе.
. (Join-Path $PSScriptRoot 'common.ps1')
$Host.UI.RawUI.WindowTitle = 'ГОТО ПОКЕР — диагностика'
Write-Title '♠ ГОТО ПОКЕР — собираю отчёт, подождите ~20 секунд...'

$cfg  = Read-Settings
$port = $cfg.PORT
$out  = New-Object System.Collections.Generic.List[string]
function Section($title, [scriptblock]$body) {
    $out.Add(''); $out.Add("===== $title =====")
    try { $out.Add((& $body 2>&1 | Out-String -Width 200).TrimEnd()) } catch { $out.Add("ошибка: $($_.Exception.Message)") }
}

Section 'Общее' {
    "Дата: $(Get-Date)"
    "Windows: $([Environment]::OSVersion.VersionString)"
    "Папка табло: $Root"
    "Порт: $port"
    "Права администратора: $(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"
}
Section 'Сервер отвечает на самом ноутбуке (127.0.0.1)' { Test-Server $port }
Section 'Кто слушает порт (должно быть 0.0.0.0:порт)' { netstat -ano | Select-String ":$port\s" }
Section 'Адреса ноутбука' {
    Get-NetIPConfiguration | ForEach-Object {
        "$($_.InterfaceAlias): IP=$($_.IPv4Address.IPAddress) шлюз=$($_.IPv4DefaultGateway.NextHop) статус=$($_.NetAdapter.Status)"
    }
}
Section 'Адрес для телефонов (как его видит табло)' { Get-LanIp }
$lan = Get-LanIp
if ($lan) {
    Section "Запрос к себе по адресу сети http://${lan}:$port" {
        try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 "http://${lan}:$port/api/state").StatusCode } catch { "НЕ ОТВЕЧАЕТ: $($_.Exception.Message)" }
    }
}
Section 'Тип сети Windows (Public = общественная, Private = частная)' {
    Get-NetConnectionProfile | ForEach-Object { "$($_.InterfaceAlias) / $($_.Name): $($_.NetworkCategory)" }
}
Section 'Состояние файрвола Windows по профилям' {
    Get-NetFirewallProfile | ForEach-Object {
        "$($_.Name): включён=$($_.Enabled) входящие_по_умолчанию=$($_.DefaultInboundAction) разрешать_правила=$($_.AllowInboundRules) правила_локальные=$($_.AllowLocalFirewallRules)"
    }
}
Section 'Наши правила файрвола' { netsh advfirewall firewall show rule name=all dir=in | Select-String -Context 0,12 'GOTO Poker' }
Section 'Запреты для node.exe' {
    Get-NetFirewallApplicationFilter | Where-Object { $_.Program -like '*node.exe' } |
        Get-NetFirewallRule | ForEach-Object { "$($_.DisplayName): $($_.Action) $($_.Direction) включено=$($_.Enabled) профиль=$($_.Profile)" }
}
Section 'Антивирусы и сторонние файрволы' {
    Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | ForEach-Object { "Антивирус: $($_.displayName)" }
    Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct -ErrorAction SilentlyContinue | ForEach-Object { "Файрвол: $($_.displayName)" }
}
Section 'Ошибки сервера (последние строки)' {
    $f = Join-Path $LogDir 'server-errors.log'
    if (Test-Path $f) { Get-Content $f -Tail 15 } else { 'нет файла' }
}
Section 'Отчёт файрвола' {
    $f = Join-Path $LogDir 'firewall.log'
    if (Test-Path $f) { Get-Content $f -Encoding UTF8 } else { 'нет файла (FIX-FIREWALL ещё не запускали)' }
}

$report = Join-Path ([Environment]::GetFolderPath('Desktop')) 'goto-diagnostika.txt'
[IO.File]::WriteAllLines($report, $out, (New-Object Text.UTF8Encoding $true))
Write-Host "  Готово: $report" -ForegroundColor Green
Start-Process notepad.exe $report
