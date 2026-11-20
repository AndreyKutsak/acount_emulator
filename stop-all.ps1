# Treds - зупинка всього проєкту (дзеркало до start-all.bat / start-all-hidden.ps1).
#
#   1) Android-телефони: штатно через ManyFaces (емулятор зберігає знімок стану, наступний
#      запуск швидкий), а що не зупинилось - через `adb emu kill` для КОЖНОГО емулятора.
#   2) Сервіси - цілими деревами процесів від їхнього кореневого cmd-вікна (svc-*.bat або
#      вікна start-all.bat): cmd -> npm -> nodemon/vite -> node, python run.py/bridge.py.
#   3) Залишки: процеси з шляхами проєкту, емулятор/qemu/scrcpy наших профілів, і все,
#      що ще слухає порти 5000/5173/8000/8900.
#
# MongoDB (служба Windows), VS Code та інші сторонні процеси не чіпаються.
# Код виходу: 0 - усі порти вільні, 1 - щось лишилось.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File stop-all.ps1

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootRx = [regex]::Escape($root)
$ports = 5000, 5173, 8000, 8900
$manyFaces = 'http://127.0.0.1:8000'
$adb = Join-Path $env:USERPROFILE '.antidetect\android\sdk\platform-tools\adb.exe'

function Say($msg) { Write-Host $msg }

function Get-Procs { Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } }

function Stop-Tree([int]$procId, [string]$why) {
    & taskkill.exe /T /F /PID $procId 2>$null | Out-Null
    Say "  - зупинено $why (PID $procId)"
}

function Test-Listening($port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

Say '============================================================'
Say '  Зупинка всіх сервісів Treds'
Say '============================================================'

# --- 1. Телефони -------------------------------------------------------------
Say '[1/4] Android-телефони'
$profiles = $null
try { $profiles = Invoke-RestMethod -Uri "$manyFaces/api/profiles" -TimeoutSec 5 } catch {}
$running = @($profiles | Where-Object { $_.engine -eq 'android' -and $_.running })
foreach ($p in $running) {
    try {
        Invoke-RestMethod -Method Post -Uri "$manyFaces/api/profiles/$($p.id)/stop" -TimeoutSec 30 | Out-Null
        Say "  - вимикаю телефон $($p.name) через ManyFaces"
    } catch {
        Say "  - ManyFaces не вимкнув $($p.name): $($_.Exception.Message)"
    }
}
if ($running.Count) {
    # Збереження знімка займає до хвилини.
    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Seconds 2
        $left = @()
        try {
            $left = @(Invoke-RestMethod -Uri "$manyFaces/api/profiles" -TimeoutSec 5 |
                Where-Object { $_.engine -eq 'android' -and $_.running })
        } catch { break }
    } while ($left.Count -and (Get-Date) -lt $deadline)
}
if (Test-Path $adb) {
    $serials = & $adb devices 2>$null | Select-String -Pattern '^(emulator-\d+)\s' |
        ForEach-Object { $_.Matches[0].Groups[1].Value }
    foreach ($s in $serials) {
        & $adb -s $s emu kill 2>$null | Out-Null
        Say "  - adb emu kill $s"
    }
}
if (-not $running.Count -and -not $serials) { Say '  телефони не запущені' }

# --- 2. Сервіси деревами від кореневого вікна ---------------------------------
Say '[2/4] Сервіси'
$rootPatterns = @(
    "$rootRx\\svc-(backend|frontend|manyfaces|bridge)\.bat",       # прихований запуск
    "cd /d `"?$rootRx\\(backend|frontend|automation)",              # вікна start-all.bat
    "cd /d `"?$rootRx\\backend\\ManyFaces"
)
$roots = Get-Procs | Where-Object {
    $_.Name -eq 'cmd.exe' -and ($cmd = $_.CommandLine) -and ($rootPatterns | Where-Object { $cmd -match $_ })
}
foreach ($r in $roots) {
    $what = if ($r.CommandLine -match 'svc-(\w+)\.bat') { $Matches[1] }
            elseif ($r.CommandLine -match '\\(backend\\ManyFaces|backend|frontend|automation)') { $Matches[1] }
            else { 'сервіс' }
    Stop-Tree $r.ProcessId $what
}
if (-not $roots) { Say '  кореневих вікон сервісів не знайдено' }

# --- 3. Залишки -----------------------------------------------------------------
Say '[3/4] Залишки'
$names = 'node.exe', 'python.exe', 'esbuild.exe', 'cmd.exe'
# vite і nodemon запускаються з node_modules проєкту - їх ловить шлях; bridge.py і run.py
# запускаються з відносним шляхом, тож шукаємо за іменем скрипта.
$leftRx = "$rootRx\\(backend|frontend|automation)\\|\bbridge\.py\b|\brun\.py\b"
$left = Get-Procs | Where-Object { $names -contains $_.Name -and $_.CommandLine -match $leftRx }
foreach ($p in $left) { Stop-Tree $p.ProcessId $p.Name }

$emuNames = 'emulator.exe', 'qemu-system-x86_64.exe', 'qemu-system-x86_64-headless.exe',
    'qemu-system-i386.exe', 'qemu-system-i386-headless.exe', 'crashpad_handler.exe', 'scrcpy.exe'
$emu = Get-Procs | Where-Object { $emuNames -contains $_.Name -and $_.CommandLine -match 'mf_|\.antidetect\\android' }
foreach ($p in $emu) { Stop-Tree $p.ProcessId $p.Name }

foreach ($port in $ports) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Tree $_.OwningProcess "процес на порту $port" }
}
if (-not $left -and -not $emu) { Say '  нічого не лишилось' }

# --- 4. Перевірка ----------------------------------------------------------------
Say '[4/4] Перевірка портів'
Start-Sleep -Seconds 2
$busy = @()
foreach ($port in $ports) {
    if (Test-Listening $port) { $busy += $port; Say "  порт ${port}: ЩЕ ПРАЦЮЄ" }
    else { Say "  порт ${port}: вільний" }
}
Say ''
if ($busy.Count) {
    Say "Не вдалося звільнити порти: $($busy -join ', '). Спробуйте ще раз або перезавантажте ПК."
    exit 1
}
Say 'Готово: backend, frontend, ManyFaces, міст і телефони зупинені. MongoDB і VS Code не чіпались.'
exit 0
