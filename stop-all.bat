@echo off
REM ============================================================
REM   Treds - зупинка всього проекту одним клiком.
REM   Уся логiка - у stop-all.ps1 (поруч). Пауза в кiнцi - лише при
REM   ручному запуску; з автоматизацiї: stop-all.bat /nopause
REM ============================================================
title Treds stop-all
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-all.ps1"
set "_code=%errorlevel%"
if /i not "%~1"=="/nopause" (
  echo.
  echo   Натиснiть будь-яку клавiшу, щоб закрити вiкно.
  pause >nul
)
exit /b %_code%
