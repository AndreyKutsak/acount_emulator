@echo off
REM ============================================================
REM   Treds - запуск усього проекту одним кликом
REM   Кожен сервiс вiдкриваеться у власному вiкнi.
REM   Зупинити все - просто закрити тi вiкна.
REM ============================================================
title Treds launcher
cd /d "%~dp0"

echo ============================================================
echo   Запуск проекту Treds
echo ============================================================
echo.

REM --- MongoDB (потрiбна backend-у; зазвичай служба Windows) ---
netstat -ano | findstr ":27017" | findstr LISTENING >nul 2>&1
if errorlevel 1 (
  echo [!] УВАГА: MongoDB не слухає 127.0.0.1:27017.
  echo     Запусти службу MongoDB або mongod вручну, iнакше backend не стартуе.
) else (
  echo [ok] MongoDB :27017
)
echo.

REM --- Backend: Express API :5000 ---
start "Treds Backend :5000" cmd /k "cd /d %~dp0backend && npm run dev"

REM --- Frontend: React/Vite :5173 ---
start "Treds Frontend :5173" cmd /k "cd /d %~dp0frontend && npm run dev"

REM --- ManyFaces: емулятори :8000 (легкий Android-пресет) ---
start "ManyFaces :8000" cmd /k "cd /d %~dp0backend\ManyFaces && set ANTIDETECT_ANDROID_IMAGE=system-images;android-29;google_apis;x86_64&& set ANTIDETECT_ANDROID_MEMORY=1536&& set ANTIDETECT_ANDROID_CORES=2&& set ANTIDETECT_ANDROID_GPU=host&& .venv\Scripts\python.exe run.py"

REM --- Android bridge + панель керування :8900 ---
start "Android Bridge :8900" cmd /k "cd /d %~dp0automation && .venv\Scripts\python.exe bridge.py"

echo   Вiдкрито 4 вiкна сервiсiв. Адреси:
echo     Frontend (додаток)   http://localhost:5173
echo     Backend API          http://localhost:5000/api/health
echo     ManyFaces (емул.)    http://127.0.0.1:8000
echo     Android-панель       http://127.0.0.1:8900
echo.
echo   Чекаю, поки backend пiднiметься, i вiдкрию додаток у браузерi...

REM Почекати, поки backend почне слухати :5000 (до ~40 с)
set /a _tries=0
:waitloop
ping -n 3 127.0.0.1 >nul
netstat -ano | findstr ":5000" | findstr LISTENING >nul 2>&1
if not errorlevel 1 goto ready
set /a _tries+=1
if %_tries% lss 20 goto waitloop

:ready
start "" http://localhost:5173
start "" http://127.0.0.1:8900
echo.
echo   Готово. Це вiкно можна закрити.
ping -n 6 127.0.0.1 >nul
