@echo off
REM ============================================================
REM   Treds - зупинка всього проекту одним кликом
REM   (дзеркало до start-all.bat)
REM   Закриває й самi cmd-вiкна сервiсiв (за командним рядком).
REM ============================================================
title Treds stop-all
echo ============================================================
echo   Зупинка всiх сервiсiв Treds
echo ============================================================
echo.

REM 1) Гречно вимкнути Android-емулятор (щоб AVD закрився коректно)
set "ADB=%USERPROFILE%\.antidetect\android\sdk\platform-tools\adb.exe"
if exist "%ADB%" (
  echo [*] вимикаю емулятор (adb emu kill)...
  "%ADB%" -s emulator-5554 emu kill >nul 2>&1
)

REM 2) Зупинити сервiснi процеси I ЇХ cmd-вiкна за командним рядком.
REM    Фiльтр за iменем процесу (cmd/node/python/nohup/esbuild/uv-python) + маркери шляху,
REM    щоб НЕ зачепити VS Code чи iншi стороннi процеси.
echo [*] закриваю вiкна й процеси сервiсiв...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$n=@('cmd.exe','node.exe','python.exe','nohup.exe','esbuild.exe'); $rx='treds\\backend|treds\\frontend|treds\\automation|ManyFaces|bridge\.py|run\.py|vite|server\.js'; Get-CimInstance Win32_Process | Where-Object { $n -contains $_.Name -and $_.CommandLine -and $_.CommandLine -match $rx } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

REM 3) Android-емулятор(и) наших профiлiв (AVD "mf_*") + qemu-движок пiд ними,
REM    незалежно вiд headless/звичайного режиму чи шляху SDK.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$n=@('emulator.exe','qemu-system-x86_64.exe','qemu-system-x86_64-headless.exe','qemu-system-i386.exe','qemu-system-i386-headless.exe'); Get-CimInstance Win32_Process | Where-Object { $n -contains $_.Name -and $_.CommandLine -and $_.CommandLine -match 'mf_|\.antidetect\\android' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

REM 4) Добити будь-що, що ще слухає нашi порти (на випадок iнших способiв запуску)
for %%P in (5000 5173 8000 8900) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do (
    taskkill /F /PID %%I >nul 2>&1 && echo   - зупинено PID %%I на порту %%P
  )
)

REM 5) Залишки дзеркала екрана / будь-якого ще живого emulator-процесу наших AVD
taskkill /F /IM scrcpy.exe >nul 2>&1

echo.
echo   Зупинено: backend(5000), frontend(5173), ManyFaces(8000), bridge(8900),
echo   їхнi cmd-вiкна, емулятор i scrcpy.
echo   MongoDB (служба Windows) та VS Code не чiпав.
echo.
echo   Перевiрка портiв:
for %%P in (5000 5173 8000 8900) do (
  netstat -ano | findstr ":%%P " | findstr LISTENING >nul 2>&1 && (echo     порт %%P: ЩЕ ПРАЦЮЄ) || (echo     порт %%P: зупинено)
)
echo.
echo   Готово. Це вiкно можна закрити.
pause >nul
