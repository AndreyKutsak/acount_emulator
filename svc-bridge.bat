@echo off
set PYTHONUNBUFFERED=1
set ADBUTILS_ADB_PATH=%USERPROFILE%\.antidetect\android\sdk\platform-tools\adb.exe
cd /d "%~dp0automation"
.venv\Scripts\python.exe bridge.py >> "%~dp0logs\bridge.log" 2>&1
