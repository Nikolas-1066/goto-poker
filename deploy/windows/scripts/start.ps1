# Запуск табло: сервер + браузер на весь экран телевизора
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$Host.UI.RawUI.WindowTitle = 'ГОТО ПОКЕР — табло'

try {
    Write-Title '♠ ГОТО ПОКЕР — запуск табло'
    $cfg  = Read-Settings
    $port = $cfg.PORT
    New-Item -ItemType Directory -Force -Path $DataDir, $LogDir | Out-Null

    if (-not (Test-Path $NodeExe)) { throw "Не найден $NodeExe. Распакуйте архив заново." }

    # 1. Сервер
    # Если порт держит табло из другой папки — оно показывало бы ЧУЖУЮ базу. Останавливаем.
    Stop-ForeignBoard $port
    $owner = Get-PortOwner $port
    if ($owner -and $owner.ProcessName -ne 'node') {
        throw "Порт $port занят программой «$($owner.ProcessName)». Закройте её или перезагрузите ноутбук."
    }
    if ($owner -and -not (Test-Server $port)) {
        # Наше табло зависло или ещё запускается (например, два запуска одновременно)
        for ($i = 0; $i -lt 20 -and -not (Test-Server $port); $i++) { Start-Sleep -Milliseconds 500 }
        if (-not (Test-Server $port)) { Stop-Server; Start-Sleep -Seconds 1 }
    }
    if (Test-Server $port) {
        Write-Host '  Сервер уже работает.' -ForegroundColor Green
    } else {
        Write-Host '  Запускаю сервер...'
        $env:NODE_ENV = 'production'
        $env:PORT = $port
        $env:HOSTNAME = '0.0.0.0'
        $env:DATA_DIR = $DataDir
        $env:ADMIN_PASSWORD = $cfg.ADMIN_PASSWORD
        $env:LAN_MODE = '1'
        $lanIp = Get-LanIp
        if ($lanIp) { $env:LAN_URL = "http://${lanIp}:$port" }
        $env:NEXT_TELEMETRY_DISABLED = '1'
        # --disable-warning: в Node 22 встроенный SQLite помечен «экспериментальным» — не пугаем журнал ошибок
        $p = Start-Process -FilePath $NodeExe -ArgumentList '--disable-warning=ExperimentalWarning', 'server.js' -WorkingDirectory $AppDir `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $LogDir 'server.log') `
            -RedirectStandardError (Join-Path $LogDir 'server-errors.log')
        Set-Content -Path $PidFile -Value $p.Id

        $ok = $false
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Milliseconds 500
            if (Test-Server $port) { $ok = $true; break }
            if ($p.HasExited) { break }
        }
        if (-not $ok) { throw "Сервер не запустился. Подробности: $LogDir\server-errors.log" }
        Write-Host '  Сервер запущен.' -ForegroundColor Green
    }

    # 2. Табло на телевизоре
    $browser = Find-Browser
    if (-not $browser) { throw 'Не найден Google Chrome или Microsoft Edge.' }

    # Реальные пиксели экранов (с учётом масштабирования Windows)
    Add-Type -Namespace Win32 -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();' -ErrorAction SilentlyContinue
    try { [Win32.Dpi]::SetProcessDPIAware() | Out-Null } catch { }
    Add-Type -AssemblyName System.Windows.Forms
    $screens = [System.Windows.Forms.Screen]::AllScreens
    $tv = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
    if (-not $tv) { $tv = [System.Windows.Forms.Screen]::PrimaryScreen }
    $x = $tv.Bounds.X + [int]($tv.Bounds.Width / 2)
    $y = $tv.Bounds.Y + [int]($tv.Bounds.Height / 2)

    Stop-Kiosk
    Start-Sleep -Milliseconds 500
    $browserArgs = @(
        '--kiosk', "http://127.0.0.1:$port/tablo",
        "--user-data-dir=`"$BrowserDir`"",
        '--autoplay-policy=no-user-gesture-required',
        "--window-position=$x,$y",
        '--no-first-run', '--no-default-browser-check',
        '--disable-session-crashed-bubble', '--disable-features=Translate',
        '--overscroll-history-navigation=0'
    )
    if ($browser.Edge) { $browserArgs += '--edge-kiosk-type=fullscreen' }
    Start-Process -FilePath $browser.Path -ArgumentList $browserArgs | Out-Null

    if ($screens.Count -lt 2) {
        Write-Host ''
        Write-Host '  Телевизор не найден как второй экран — табло открыто на этом экране.' -ForegroundColor DarkYellow
        Write-Host '  Подключите HDMI, нажмите Win+P → «Расширить» и запустите табло ещё раз.' -ForegroundColor DarkYellow
    } else {
        Write-Host ''
        Write-Host '  Если табло открылось не на телевизоре: щёлкните по нему и нажмите Win+Shift+→' -ForegroundColor DarkGray
    }

    # 3. Подсказка для телефонов
    $ip = Get-LanIp
    Write-Host ''
    Write-Host '  ТАБЛО ЗАПУЩЕНО' -ForegroundColor Green
    Write-Host ''
    Write-Host '  Управление (админка):'
    Write-Host "    на этом ноутбуке:  http://127.0.0.1:$port/admin" -ForegroundColor Cyan
    if ($ip) {
        Write-Host "    с телефона (Wi-Fi клуба):  http://${ip}:$port/admin" -ForegroundColor Cyan
    } else {
        Write-Host '    с телефона: ноутбук не подключён к сети Wi-Fi/кабелем' -ForegroundColor DarkYellow
    }
    $problems = Get-LanProblems $port
    if ($problems.Count -gt 0) {
        Write-Host ''
        Write-Host '  ! Телефоны не смогут подключиться:' -ForegroundColor Red
        foreach ($p in $problems) { Write-Host "    - $p" -ForegroundColor Red }
        Write-Host ''
        Write-Host '  Сейчас Windows спросит разрешение — нажмите «Да», чтобы исправить.' -ForegroundColor Yellow
        try {
            $fix = Join-Path $PSScriptRoot 'firewall.ps1'
            Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$fix`"")
        } catch { }
        if ((Get-LanProblems $port).Count -eq 0) {
            Write-Host '  ✓ Исправлено: телефоны могут подключаться.' -ForegroundColor Green
        } else {
            Write-Host "  Не получилось. Пришлите файл $LogDir\firewall.log" -ForegroundColor Red
            Write-Host '  Если на ноутбуке стоит антивирус (Касперский, ESET, Dr.Web...) — в нём' -ForegroundColor Red
            Write-Host '  свой файрвол: разрешите в нём программу node.exe из папки табло.' -ForegroundColor Red
            Start-Sleep -Seconds 60
        }
    }
    Write-Host ''
    Write-Host '  Это окно можно закрыть — табло продолжит работать.'
    Write-Host '  Выключить: ярлык «ГОТО ПОКЕР — выключить табло».'
    Write-Host ''
    Start-Sleep -Seconds 30
} catch {
    Write-Host ''
    Write-Host "  ОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
    Read-Host '  Нажмите Enter, чтобы закрыть'
}
