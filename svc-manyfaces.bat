@echo off
set PYTHONUNBUFFERED=1
set ANTIDETECT_ANDROID_IMAGE=system-images;android-29;google_apis;x86_64
set ANTIDETECT_ANDROID_MEMORY=2048
set ANTIDETECT_ANDROID_CORES=4
set ANTIDETECT_ANDROID_GPU=host
cd /d "%~dp0backend\ManyFaces"
.venv\Scripts\python.exe run.py >> "%~dp0logs\manyfaces.log" 2>&1
