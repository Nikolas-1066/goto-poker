# Общие пути и функции для скриптов табло ГОТО ПОКЕР (Windows PowerShell 5.1+)

$Sys          = Split-Path -Parent $PSScriptRoot          # ...\GOTO-Poker\system
$Root         = Split-Path -Parent $Sys                   # ...\GOTO-Poker
$NodeExe      = Join-Path $Sys 'node.exe'
$AppDir       = Join-Path $Sys 'app'
$DataDir      = Join-Path $Root 'data'
$LogDir       = Join-Path $Root 'logs'
$BrowserDir   = Join-Path $Root 'browser-profile'
$SettingsFile = Join-Path $Root 'settings.ini'
$PidFile      = Join-Path $LogDir 'server.pid'

function Read-Settings {
    $h = @{ PORT = '3000'; ADMIN_PASSWORD = 'goto' }
    if (Test-Path $SettingsFile) {
        foreach ($line in [IO.File]::ReadAllLines($SettingsFile)) {
            if ($line -match '^\s*([A-Z_]+)\s*=(.*)$') { $h[$Matches[1]] = $Matches[2].Trim() }
        }
    }
    return $h
}

function Write-Settings($h) {
    $lines = @('# Настройки табло ГОТО ПОКЕР')
    foreach ($k in $h.Keys) { $lines += "$k=$($h[$k])" }
    [IO.File]::WriteAllLines($SettingsFile, $lines, (New-Object Text.UTF8Encoding $false))
}

function Test-Server($port) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$port/api/state"
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function Get-LanIp {
    # Адрес адаптера, через который ноутбук реально выходит в сеть (есть шлюз)
    try {
        $ip = Get-NetIPConfiguration -ErrorAction Stop |
            Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
            Select-Object -First 1 | ForEach-Object { $_.IPv4Address.IPAddress } | Select-Object -First 1
        if ($ip) { return $ip }
    } catch { }
    try {
        $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))' -and $_.PrefixOrigin -ne 'WellKnown' } |
            Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress
        if ($ip) { return $ip }
    } catch { }
    return $null
}

function Find-Browser {
    $candidates = @(
        @{ Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"; Edge = $false },
        @{ Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"; Edge = $false },
        @{ Path = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"; Edge = $false },
        @{ Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"; Edge = $true },
        @{ Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"; Edge = $true }
    )
    foreach ($c in $candidates) { if ($c.Path -and (Test-Path $c.Path)) { return $c } }
    return $null
}

# Закрыть окно табло (браузер с нашим отдельным профилем), не трогая обычный браузер
function Stop-Kiosk {
    $profileDir = $BrowserDir.ToLower()
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($profileDir) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# Какой процесс слушает порт (или $null)
function Get-PortOwner($port) {
    try {
        $c = Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction Stop | Select-Object -First 1
        if ($c) { return Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue }
    } catch { }
    return $null
}

# Остановить табло, запущенное из ДРУГОЙ папки (старая копия, старый ярлык автозапуска)
function Stop-ForeignBoard($port) {
    $owner = Get-PortOwner $port
    if ($owner -and $owner.ProcessName -eq 'node' -and $owner.Path -ne $NodeExe) {
        Write-Host "  Найдено табло из другой папки ($($owner.Path)) — останавливаю." -ForegroundColor DarkYellow
        Stop-Process -Id $owner.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

function Stop-Server {
    if (Test-Path $PidFile) {
        $procId = Get-Content $PidFile -ErrorAction SilentlyContinue
        if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }
    # На всякий случай — любой node.exe именно из нашей папки
    Get-Process node -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $NodeExe } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    # И любое табло (node.exe), которое держит наш порт — например, из старой папки
    $owner = Get-PortOwner (Read-Settings).PORT
    if ($owner -and $owner.ProcessName -eq 'node') { Stop-Process -Id $owner.Id -Force -ErrorAction SilentlyContinue }
}

# ---------- Файрвол ----------
$FwRulePort = 'GOTO Poker (port)'
$FwRuleNode = 'GOTO Poker (node)'

# Есть ли разрешающее правило. netsh работает и без прав администратора,
# и не зависит от языка Windows (смотрим только код возврата).
function Test-FirewallRule {
    & netsh advfirewall firewall show rule name="$FwRulePort" *> $null
    return ($LASTEXITCODE -eq 0)
}

# Создать разрешения и удалить запреты. Нужны права администратора.
function Repair-Firewall($port) {
    $log = @()
    # Старые и наши правила — пересоздаём заново
    foreach ($n in @('GOTO Poker', $FwRulePort, $FwRuleNode)) {
        & netsh advfirewall firewall delete rule name="$n" *> $null
    }
    # Запреты для node.exe (появляются, если в окне Windows нажали «Отмена») сильнее разрешений
    try {
        Get-NetFirewallApplicationFilter -ErrorAction Stop |
            Where-Object { $_.Program -like '*node.exe' } |
            Get-NetFirewallRule -ErrorAction SilentlyContinue |
            Where-Object { $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' } |
            ForEach-Object { $log += "удалён запрет: $($_.DisplayName)"; $_ } |
            Remove-NetFirewallRule -ErrorAction SilentlyContinue
    } catch { $log += "поиск запретов: $($_.Exception.Message)" }

    # Разрешение по порту — работает, даже если папку табло перенесут
    & netsh advfirewall firewall add rule name="$FwRulePort" dir=in action=allow protocol=TCP localport=$port profile=any enable=yes | Out-Null
    $log += "правило порта ${port}: код $LASTEXITCODE"
    # И по программе — для надёжности
    & netsh advfirewall firewall add rule name="$FwRuleNode" dir=in action=allow program="$NodeExe" profile=any enable=yes | Out-Null
    $log += "правило node.exe: код $LASTEXITCODE"

    # Сеть клуба помечаем как «частную»: в «общественной» Windows может резать все входящие
    try {
        Get-NetConnectionProfile -ErrorAction Stop | Where-Object { $_.NetworkCategory -eq 'Public' } | ForEach-Object {
            Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
            $log += "сеть «$($_.Name)» переведена в частную"
        }
    } catch { $log += "тип сети: $($_.Exception.Message)" }
    # Разрешить работу наших правил, если включено «блокировать все входящие»
    try {
        Set-NetFirewallProfile -Profile Domain,Private,Public -AllowInboundRules True -ErrorAction Stop
    } catch { $log += "профили файрвола: $($_.Exception.Message)" }

    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $log += (& netsh advfirewall firewall show rule name="$FwRulePort" 2>&1 | Out-String)
    [IO.File]::WriteAllLines((Join-Path $LogDir 'firewall.log'), [string[]]$log, (New-Object Text.UTF8Encoding $false))
    return (Test-FirewallRule)
}

# Проверка, что телефоны смогут подключиться (возвращает список проблем)
function Get-LanProblems($port) {
    $problems = @()
    if (-not (Test-FirewallRule)) { $problems += 'нет разрешения в файрволе Windows' }
    try {
        $blocks = Get-NetFirewallApplicationFilter -ErrorAction Stop |
            Where-Object { $_.Program -like '*node.exe' } |
            Get-NetFirewallRule -ErrorAction SilentlyContinue |
            Where-Object { $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' -and $_.Enabled -eq 'True' }
        if ($blocks) { $problems += 'файрвол Windows запрещает node.exe принимать подключения' }
    } catch { }
    return $problems
}

function Write-Title($text) {
    Write-Host ''
    Write-Host "  $text" -ForegroundColor Yellow
    Write-Host ''
}
