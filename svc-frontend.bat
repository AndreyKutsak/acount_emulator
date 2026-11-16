@echo off
cd /d "%~dp0frontend"
npm run dev >> "%~dp0logs\frontend.log" 2>&1
