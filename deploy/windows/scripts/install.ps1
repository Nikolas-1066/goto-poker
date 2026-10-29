# Установка табло ГОТО ПОКЕР на ноутбук (один раз). Запускается через INSTALL.bat.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

# Нужны права администратора (ярлыки для всех пользователей, файрвол, питание)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    exit
}

$Host.UI.RawUI.WindowTitle = 'ГОТО ПОКЕР — установка'

function Ask-YesNo($question) {
    $a = Read-Host "  $question (Д/Н)"
    return $a -match '^\s*[ДдYy]'
}

try {
    Write-Title '♠ ГОТО ПОКЕР — установка табло'

    # Снять пометку «скачано из интернета», иначе Windows может блокировать скрипты
    Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

    if (-not (Test-Path $NodeExe)) { throw "Не найден $NodeExe. Распакуйте архив полностью." }
    New-Item -ItemType Directory -Force -Path $DataDir, $LogDir | Out-Null

    # 1. Пароль админки
    $cfg = Read-Settings
    $hasPassword = (Test-Path $SettingsFile) -and $cfg.ADMIN_PASSWORD -and $cfg.ADMIN_PASSWORD -ne 'goto'
    if (-not $hasPassword -or (Ask-YesNo 'Пароль админки уже задан. Сменить?')) {
        do {
            $pass = Read-Host '  Придумайте пароль для админки (минимум 4 символа)'
        } while ($pass.Length -lt 4)
        $cfg.ADMIN_PASSWORD = $pass
    }
    if (-not $cfg.PORT) { $cfg.PORT = '3000' }
    Write-Settings $cfg
    Write-Host '  ✓ Пароль сохранён' -ForegroundColor Green

    # 2. Разрешить телефонам подключаться к ноутбуку (файрвол)
    if (-not (Repair-Firewall $cfg.PORT)) {
        throw "Не удалось открыть доступ в файрволе. Подробности: $LogDir\firewall.log"
    }
    Write-Host '  ✓ Доступ с телефонов разрешён' -ForegroundColor Green

    # 3. Ярлыки на рабочем столе (для всех пользователей)
    $desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
    $icon = Join-Path $Sys 'goto.ico'
    $shell = New-Object -ComObject WScript.Shell
    function New-Shortcut($name, $target, $description) {
        $lnk = $shell.CreateShortcut((Join-Path $desktop "$name.lnk"))
        $lnk.TargetPath = $target
        $lnk.WorkingDirectory = $Root
        $lnk.IconLocation = $icon
        $lnk.Description = $description
        $lnk.Save()
    }
    New-Shortcut 'ГОТО ПОКЕР — запустить табло' (Join-Path $Root 'START.bat') 'Запустить табло турнира на телевизоре'
    New-Shortcut 'ГОТО ПОКЕР — выключить табло' (Join-Path $Root 'STOP.bat') 'Выключить табло'
    $url = "[InternetShortcut]`r`nURL=http://127.0.0.1:$($cfg.PORT)/admin`r`nIconFile=$icon`r`nIconIndex=0`r`n"
    [IO.File]::WriteAllText((Join-Path $desktop 'ГОТО ПОКЕР — админка.url'), $url)
    Write-Host '  ✓ Ярлыки на рабочем столе созданы' -ForegroundColor Green

    # 4. Автозапуск
    Write-Host ''
    $startup = [Environment]::GetFolderPath('CommonStartup')
    $autoLnk = Join-Path $startup 'ГОТО ПОКЕР — табло.lnk'
    if (Ask-YesNo 'Запускать табло автоматически при включении ноутбука?') {
        $lnk = $shell.CreateShortcut($autoLnk)
        $lnk.TargetPath = Join-Path $Root 'START.bat'
        $lnk.WorkingDirectory = $Root
        $lnk.IconLocation = $icon
        $lnk.WindowStyle = 7   # свернуть окно
        $lnk.Save()
        Write-Host '  ✓ Автозапуск включён' -ForegroundColor Green
    } elseif (Test-Path $autoLnk) {
        Remove-Item $autoLnk -Force
    }

    # 5. Питание: не засыпать от сети и при закрытой крышке
    Write-Host ''
    if (Ask-YesNo 'Не давать ноутбуку засыпать, когда он подключён к зарядке (и работать с закрытой крышкой)?') {
        powercfg /change standby-timeout-ac 0 | Out-Null
        powercfg /change monitor-timeout-ac 0 | Out-Null
        powercfg /change hibernate-timeout-ac 0 | Out-Null
        powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 | Out-Null
        powercfg /setactive SCHEME_CURRENT | Out-Null
        Write-Host '  ✓ Ноутбук не будет засыпать от сети' -ForegroundColor Green
    }

    Write-Title 'Готово! Для запуска — ярлык «ГОТО ПОКЕР — запустить табло» на рабочем столе.'
    if (Ask-YesNo 'Запустить табло сейчас?') {
        # через explorer — чтобы табло работало с обычными правами, а не администратора
        Start-Process explorer.exe -ArgumentList "`"$(Join-Path $Root 'START.bat')`""
    }
} catch {
    Write-Host ''
    Write-Host "  ОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
    Read-Host '  Нажмите Enter, чтобы закрыть'
}
