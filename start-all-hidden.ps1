# Treds - прихований запуск усього стеку (без видимих вікон).
# Викликається Планувальником завдань Windows при вході в систему.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$launcherLog = Join-Path $logs 'launcher.log'

function Log($msg) {
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg" | Out-File -FilePath $launcherLog -Append -Encoding utf8
}

function Test-Port($port) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $port)
        $c.Close()
        return $true
    } catch {
        return $false
    }
}

Log "=== start-all-hidden: запуск ==="

if (Test-Port 27017) {
    Log "MongoDB :27017 - ok"
} else {
    Log "MongoDB :27017 - НЕ слухає (backend може не піднятись)"
}

function Start-Svc($name, $bat) {
    if (Test-Path $bat) {
        Start-Process -FilePath $bat -WindowStyle Hidden
        Log "запущено: $name"
    } else {
        Log "ПОМИЛКА: не знайдено $bat"
    }
}

Start-Svc 'backend'   (Join-Path $root 'svc-backend.bat')
Start-Sleep -Seconds 3
Start-Svc 'frontend'  (Join-Path $root 'svc-frontend.bat')
Start-Svc 'manyfaces' (Join-Path $root 'svc-manyfaces.bat')
Start-Svc 'bridge'    (Join-Path $root 'svc-bridge.bat')

Log "=== start-all-hidden: усі процеси запущено ==="
