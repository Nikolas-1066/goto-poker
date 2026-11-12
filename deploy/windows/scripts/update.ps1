# Обновление табло ГОТО ПОКЕР. Запускается через UPDATE.bat из распакованного нового архива.
# Делает всё сам:
#   1. находит ВСЕ копии табло на ноутбуке (по ярлыкам, автозапуску, запущенным программам, папкам);
#   2. останавливает все табло и окна табло на телевизоре;
#   3. выбирает самую свежую базу (по последнему действию в ней) — спрашивает подтверждение;
#   4. ставит новую версию в одну постоянную папку C:\GOTO-Poker, переносит туда базу и пароль;
#   5. пересоздаёт ярлыки и автозапуск, старые копии помечает «не запускать»;
#   6. запускает табло.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$Pkg    = $Root                      # папка распакованного архива
$Target = 'C:\GOTO-Poker'            # постоянная папка табло

# Нужны права администратора (папка на диске C:, ярлыки для всех, файрвол)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    exit
}
$Host.UI.RawUI.WindowTitle = 'ГОТО ПОКЕР — обновление'
# Журнал всего окна — если что-то пойдёт не так, пришлите файл update-log.txt из папки архива
try { Start-Transcript -Path (Join-Path $Pkg 'update-log.txt') -Force | Out-Null } catch { }

function Same($a, $b) { return ([IO.Path]::GetFullPath($a).TrimEnd('\') -ieq [IO.Path]::GetFullPath($b).TrimEnd('\')) }

function Copy-Dir($from, $to, [switch]$Mirror) {
    $rc = @($from, $to, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
    if ($Mirror) { $rc += '/MIR' }
    & robocopy @rc | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Не удалось скопировать $from -> $to (robocopy, код $LASTEXITCODE)" }
}

function Format-Ms($ms) {
    if (-not $ms -or $ms -le 0) { return 'нет данных' }
    return [DateTimeOffset]::FromUnixTimeMilliseconds([long]$ms).LocalDateTime.ToString('dd.MM.yyyy HH:mm')
}

try {
    Write-Title '♠ ГОТО ПОКЕР — обновление табло'
    Get-ChildItem -Path $Pkg -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
    $version = ''
    $vf = Join-Path $Pkg 'system\VERSION.txt'
    if (Test-Path -LiteralPath $vf) { $version = (Get-Content -LiteralPath $vf -TotalCount 1).Trim() }
    if ($version) { Write-Host "  Новая версия: v$version" -ForegroundColor Cyan }

    # ---------- 1. Ищем все копии табло ----------
    # Поиск никогда не прерывает обновление: недоступные и странные папки просто пропускаем
    Write-Host '  Ищу табло на ноутбуке...'
    $ErrorActionPreference = 'Continue'
    $roots = New-Object 'System.Collections.Generic.List[string]'
    function Add-Root([string]$p) {
        if (-not $p) { return }
        try {
            $full = [IO.Path]::GetFullPath($p.Trim('"').TrimEnd('\'))
            # короткие имена вида C:\Users\4F86~1 → полные
            $full = (Get-Item -LiteralPath $full -ErrorAction Stop).FullName.TrimEnd('\')
            if (-not (Test-Path -LiteralPath (Join-Path $full 'system\app\server.js'))) { return }
        } catch { return }
        foreach ($r in $roots) { if ($r -ieq $full) { return } }
        $roots.Add($full)
    }
    Add-Root $Target
    Add-Root $Pkg

    # ярлыки на рабочих столах и в автозапуске (у всех пользователей)
    $userDirs = @(Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    $desktops = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory')) +
        @($userDirs | ForEach-Object { Join-Path $_ 'Desktop'; Join-Path $_ 'OneDrive\Desktop'; Join-Path $_ 'OneDrive\Рабочий стол' })
    $startups = @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup')) +
        @($userDirs | ForEach-Object { Join-Path $_ 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup' })
    $oldLinks = New-Object 'System.Collections.Generic.List[string]'
    $hadAutostart = $false
    $shell = New-Object -ComObject WScript.Shell
    foreach ($d in (@($desktops) + @($startups) | Where-Object { $_ } | Select-Object -Unique)) {
        try { if (-not (Test-Path -LiteralPath $d)) { continue } } catch { continue }
        $isStartup = $startups -contains $d
        foreach ($f in @(Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue)) {
            if ($f.Extension -ieq '.lnk') {
                $t = ''
                try { $t = $shell.CreateShortcut($f.FullName).TargetPath } catch { }
                if ($t -match '\\(START|STOP)\.bat$') {
                    Add-Root (Split-Path -Parent $t)
                    $oldLinks.Add($f.FullName)
                    if ($isStartup) { $hadAutostart = $true }
                }
            } elseif ($f.Extension -ieq '.url' -and $f.Name -like 'ГОТО ПОКЕР*') {
                $oldLinks.Add($f.FullName)
            }
        }
    }
    # запущенные табло и окна табло
    foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)) {
        if ($p.ExecutablePath -and $p.ExecutablePath -like '*\system\node.exe') {
            Add-Root (Split-Path -Parent (Split-Path -Parent $p.ExecutablePath))
        }
    }
    foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue)) {
        if ($p.CommandLine -and $p.CommandLine -match '--user-data-dir="?([^"]+?)\\browser-profile') { Add-Root $Matches[1] }
    }
    # папки, куда обычно распаковывают архив
    $search = @()
    foreach ($u in $userDirs) { foreach ($s in 'Downloads', 'Desktop', 'Documents', 'OneDrive') { $search += (Join-Path $u $s) } }
    foreach ($s in $search) {
        try {
            if (-not (Test-Path -LiteralPath $s)) { continue }
            Get-ChildItem -LiteralPath $s -Filter 'START.bat' -Recurse -Depth 3 -File -ErrorAction SilentlyContinue |
                ForEach-Object { Add-Root $_.DirectoryName }
        } catch { }
    }
    foreach ($drive in 'C:\', 'D:\') {
        try {
            if (-not (Test-Path -LiteralPath $drive)) { continue }
            Get-ChildItem -LiteralPath $drive -Filter 'START.bat' -Recurse -Depth 1 -File -ErrorAction SilentlyContinue |
                ForEach-Object { Add-Root $_.DirectoryName }
        } catch { }
    }
    $ErrorActionPreference = 'Stop'
    Write-Host "  Найдено копий табло: $($roots.Count)" -ForegroundColor DarkGray

    # ---------- 2. Останавливаем все табло ----------
    Write-Host '  Останавливаю табло...'
    foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)) {
        if ($p.ExecutablePath -and $p.ExecutablePath -like '*\system\node.exe') {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue)) {
        $cl = [string]$p.CommandLine
        if ($cl -like '*browser-profile*' -or ($cl -like '*--kiosk*' -and $cl -match '127\.0\.0\.1|localhost')) {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 2

    # ---------- 3. Выбираем базу ----------
    $node    = Join-Path $Pkg 'system\node.exe'
    $inspect = Join-Path $PSScriptRoot 'inspect-db.cjs'
    # временная папка — рядом с архивом (папка TEMP бывает с коротким именем вида C:\Users\4F86~1)
    $tmp     = Join-Path $Pkg ('_update-tmp-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $cands   = @()
    $n = 0
    foreach ($r in $roots) {
        $db = Join-Path $r 'data\goto-poker.db'
        if (-not (Test-Path -LiteralPath $db)) { continue }
        $n++
        $d = Join-Path $tmp $n
        [IO.Directory]::CreateDirectory($d) | Out-Null
        foreach ($ext in '', '-wal', '-shm') {
            if (Test-Path -LiteralPath "$db$ext") { [IO.File]::Copy("$db$ext", (Join-Path $d "goto-poker.db$ext"), $true) }
        }
        $info = $null
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $out = & $node --disable-warning=ExperimentalWarning $inspect (Join-Path $d 'goto-poker.db') 2>$null
            $info = ($out | Select-Object -Last 1) | ConvertFrom-Json
        } catch { }
        $ErrorActionPreference = $prev
        $ok = [bool]($info -and $info.ok)
        $cands += [pscustomobject]@{
            Root = $r; Ok = $ok
            Last = $(if ($ok) { [long]$info.last } else { 0 })
            Players = $(if ($ok) { [int]$info.players } else { 0 })
            Tours = $(if ($ok) { [int]$info.tours } else { 0 })
        }
    }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue

    $best = $null
    if ($cands.Count -gt 0) {
        $cands = @($cands | Sort-Object -Property @{ Expression = { [int]$_.Ok }; Descending = $true }, @{ Expression = 'Last'; Descending = $true })
        Write-Host ''
        Write-Host '  Найденные базы (сверху — самая свежая):'
        for ($i = 0; $i -lt $cands.Count; $i++) {
            $c = $cands[$i]
            if ($c.Ok) {
                Write-Host ("   {0}. последнее действие {1} · игроков {2} · турниров {3}" -f ($i + 1), (Format-Ms $c.Last), $c.Players, $c.Tours) -ForegroundColor White
            } else {
                Write-Host ("   {0}. база повреждена или не читается" -f ($i + 1)) -ForegroundColor Red
            }
            Write-Host "      $($c.Root)" -ForegroundColor DarkGray
        }
        $pick = 0
        if (-not $cands[0].Ok) { throw 'Ни одна база не читается. Ничего не меняю — пришлите фото этого окна.' }
        Write-Host ''
        $a = Read-Host "  Переносим базу №1 (самую свежую). Enter — да, или введите другой номер"
        if ($a -match '^\s*(\d+)\s*$') {
            $pick = [int]$Matches[1] - 1
            if ($pick -lt 0 -or $pick -ge $cands.Count -or -not $cands[$pick].Ok) { throw 'Такого номера нет (или база повреждена). Запустите UPDATE.bat заново.' }
        }
        $best = $cands[$pick]
    } else {
        Write-Host '  Баз не найдено — это первая установка.' -ForegroundColor DarkYellow
    }

    # ---------- 4. Ставим программу в C:\GOTO-Poker ----------
    Write-Host ''
    Write-Host "  Устанавливаю в $Target ..."
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    if (-not (Same $Pkg $Target)) {
        Copy-Dir (Join-Path $Pkg 'system') (Join-Path $Target 'system') -Mirror
        Get-ChildItem -LiteralPath $Pkg -File | Where-Object { $_.Extension -ieq '.bat' -or $_.Name -ieq 'README-RU.txt' } |
            ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Target -Force }
    }

    # база и пароль — из выбранной копии
    if ($best -and -not (Same $best.Root $Target)) {
        $tData = Join-Path $Target 'data'
        if (Test-Path -LiteralPath $tData) {
            $bk = Join-Path $Target ('data-до-обновления-' + (Get-Date -Format 'yyyyMMdd-HHmm'))
            Move-Item -LiteralPath $tData -Destination $bk
            Write-Host "  Прежняя база из $Target сохранена в $bk" -ForegroundColor DarkGray
        }
        Copy-Dir (Join-Path $best.Root 'data') $tData
        $ini = Join-Path $best.Root 'settings.ini'
        if (Test-Path -LiteralPath $ini) { Copy-Item -LiteralPath $ini -Destination (Join-Path $Target 'settings.ini') -Force }
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $Target 'data'), (Join-Path $Target 'logs') | Out-Null
    # табло работает с обычными правами — даём пользователям право писать в папку
    & icacls $Target /grant '*S-1-5-32-545:(OI)(CI)M' /T /C /Q | Out-Null

    # дальше работаем с путями постоянной папки
    . (Join-Path $Target 'system\scripts\common.ps1')
    if (-not (Test-Path -LiteralPath $SettingsFile)) {
        foreach ($r in $roots) {
            $ini = Join-Path $r 'settings.ini'
            if (Test-Path -LiteralPath $ini) { Copy-Item -LiteralPath $ini -Destination $SettingsFile -Force; break }
        }
    }
    $cfg = Read-Settings
    if (-not (Test-Path -LiteralPath $SettingsFile) -or -not $cfg.ADMIN_PASSWORD -or $cfg.ADMIN_PASSWORD -eq 'goto') {
        do { $pass = Read-Host '  Придумайте пароль для админки (минимум 4 символа)' } while ($pass.Length -lt 4)
        $cfg.ADMIN_PASSWORD = $pass
    }
    if (-not $cfg.PORT) { $cfg.PORT = '3000' }
    Write-Settings $cfg
    Write-Host '  ✓ Программа, база и пароль на месте' -ForegroundColor Green

    # ---------- 5. Файрвол, ярлыки, старые копии ----------
    if (-not (Repair-Firewall $cfg.PORT)) {
        Write-Host "  ! Не удалось настроить файрвол (подробности: $LogDir\firewall.log)" -ForegroundColor DarkYellow
    }
    foreach ($l in $oldLinks) { Remove-Item -LiteralPath $l -Force -ErrorAction SilentlyContinue }
    $desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
    $icon = Join-Path $Sys 'goto.ico'
    function New-Shortcut($path, $target, $description, $style) {
        $lnk = $shell.CreateShortcut($path)
        $lnk.TargetPath = $target
        $lnk.WorkingDirectory = $Root
        $lnk.IconLocation = $icon
        $lnk.Description = $description
        if ($style) { $lnk.WindowStyle = $style }
        $lnk.Save()
    }
    New-Shortcut (Join-Path $desktop 'ГОТО ПОКЕР — запустить табло.lnk') (Join-Path $Root 'START.bat') 'Запустить табло турнира на телевизоре' $null
    New-Shortcut (Join-Path $desktop 'ГОТО ПОКЕР — выключить табло.lnk') (Join-Path $Root 'STOP.bat') 'Выключить табло' $null
    $url = "[InternetShortcut]`r`nURL=http://127.0.0.1:$($cfg.PORT)/admin`r`nIconFile=$icon`r`nIconIndex=0`r`n"
    [IO.File]::WriteAllText((Join-Path $desktop 'ГОТО ПОКЕР — админка.url'), $url)
    if ($hadAutostart) {
        New-Shortcut (Join-Path ([Environment]::GetFolderPath('CommonStartup')) 'ГОТО ПОКЕР — табло.lnk') (Join-Path $Root 'START.bat') 'Табло ГОТО ПОКЕР' 7
    }
    Write-Host '  ✓ Ярлыки на рабочем столе обновлены' -ForegroundColor Green

    # старые копии больше не запустятся по ошибке (данные в них не трогаем)
    foreach ($r in $roots) {
        if (Same $r $Target) { continue }
        foreach ($b in 'START.bat', 'INSTALL.bat') {
            $f = Join-Path $r $b
            if (Test-Path -LiteralPath $f) { Rename-Item -LiteralPath $f -NewName "$b.old" -Force -ErrorAction SilentlyContinue }
        }
        $note = "Это старая копия табло. Табло теперь в $Target — запускайте ярлыком на рабочем столе.`r`nЭту папку можно удалить."
        [IO.File]::WriteAllText((Join-Path $r 'СТАРАЯ КОПИЯ - НЕ ЗАПУСКАТЬ.txt'), $note, (New-Object Text.UTF8Encoding $true))
    }

    # ---------- 6. Запуск ----------
    Write-Title "Готово! Табло обновлено$(if ($version) { " до версии v$version" })."
    Write-Host "  Папка табло: $Target"
    Write-Host "  Версия видна внизу табло, рядом с надписью «ГОТО ПОКЕР»$(if ($version) { ": v$version" })."
    Write-Host ''
    Write-Host '  Запускаю табло...'
    # через explorer — чтобы табло работало с обычными правами, а не администратора
    Start-Process explorer.exe -ArgumentList "`"$(Join-Path $Root 'START.bat')`""
    try { Stop-Transcript | Out-Null } catch { }
    Start-Sleep -Seconds 10
} catch {
    Write-Host ''
    Write-Host "  ОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  (строка $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim()))" -ForegroundColor DarkGray
    Write-Host ''
    Write-Host "  Пришлите фото этого окна или файл update-log.txt из папки $Pkg" -ForegroundColor Yellow
    Write-Host '  Старое табло и база не тронуты, если ошибка случилась до шага «Устанавливаю».'
    try { Stop-Transcript | Out-Null } catch { }
    Read-Host '  Нажмите Enter, чтобы закрыть'
}
