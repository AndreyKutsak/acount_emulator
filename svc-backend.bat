@echo off
cd /d "%~dp0backend"
npm run dev >> "%~dp0logs\backend.log" 2>&1
