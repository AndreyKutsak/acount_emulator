@echo off
REM ============================================================
REM   Magisk на Android-емулятор (AVD) через rootAVD
REM   https://github.com/newbit1/rootAVD
REM
REM   ВАЖЛИВО: рутуються лише образи google_apis / AOSP (userdebug).
REM   Образи google_apis_PLAYSTORE (production) НЕ рутуються цим способом.
REM   Для Threads бери образ "Google APIs" (не Play Store), API 34.
REM
REM   Використання:
REM     root-avd.bat                 -- показати список ramdisk-ів (ListAllAVDs)
REM     root-avd.bat <ramdisk-path>  -- пропатчити конкретний ramdisk (встановити Magisk)
REM
REM   Приклад шляху ramdisk (його друкує ListAllAVDs):
REM     system-images\android-34\google_apis\x86_64\ramdisk.img
REM ============================================================
setlocal
set "SDK=%USERPROFILE%\.antidetect\android\sdk"
set "ADB=%SDK%\platform-tools\adb.exe"
set "ROOTAVD=%~dp0rootAVD"

if not exist "%SDK%" (
  echo [X] Не знайдено Android SDK: %SDK%
  echo     Спершу встанови Android-рушій у ManyFaces (one-click install).
  exit /b 1
)

REM Клонувати rootAVD, якщо ще немає
if not exist "%ROOTAVD%\rootAVD.bat" (
  echo [*] Клоную rootAVD...
  git clone https://github.com/newbit1/rootAVD "%ROOTAVD%" || (
    echo [X] git clone не вдався. Встанови git або завантаж rootAVD вручну в %ROOTAVD%
    exit /b 1
  )
)

cd /d "%ROOTAVD%"
set "ANDROID_SDK_ROOT=%SDK%"
set "ANDROID_HOME=%SDK%"

if "%~1"=="" (
  echo.
  echo [*] Список доступних ramdisk-ів (скопіюй потрібний шлях і запусти:
  echo        root-avd.bat ^<ramdisk-path^> ):
  echo.
  call rootAVD.bat ListAllAVDs
  echo.
  echo [i] Далі: root-avd.bat system-images\android-34\google_apis\x86_64\ramdisk.img
  goto :eof
)

echo [*] Патчу ramdisk і встановлюю Magisk: %~1
call rootAVD.bat %~1
echo.
echo [i] Коли емулятор перезавантажиться:
echo     1) Відкрий застосунок Magisk (він встановиться автоматично), доналаштуй якщо попросить.
echo     2) Magisk ^> Settings: увiмкни Zygisk, перезавантаж.
echo     3) Встанови модуль "Play Integrity Fix" (Magisk ^> Modules ^> Install from storage).
echo        Файл модуля залий на пристрій: adb push PlayIntegrityFix.zip /sdcard/Download/
echo     4) Magisk ^> DenyList: додай com.instagram.barcelona (Threads), увiмкни Enforce DenyList.
echo     5) Для IMEI/SIM-спуфу: встанови LSPosed (Zygisk-версію) + модуль Device Faker/XPrivacyLua.
goto :eof
