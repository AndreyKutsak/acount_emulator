"""
Android automation template (uiautomator2) для емулятора ManyFaces.

Запуск:
    .venv\\Scripts\\python.exe android_automation.py            # демо на Settings
    .venv\\Scripts\\python.exe android_automation.py --install app.apk
    .venv\\Scripts\\python.exe android_automation.py --launch com.android.deskclock

Пристрій за замовчуванням: emulator-5554 (adb має його бачити: `adb devices`).

uiautomator2 при першому підключенні сам ставить на пристрій свій
UI-сервер (APK) — це нормально, займає кілька секунд.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import uiautomator2 as u2

# Вивід у UTF-8, щоб не падати на не-ASCII (стрілки, кирилиця) у cp1251/cp866-консолі.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

SHOTS = Path(__file__).parent / "shots"
SHOTS.mkdir(exist_ok=True)


# ---------------------------------------------------------------- helpers ----
def connect(serial: str) -> u2.Device:
    """Підключитися до пристрою й переконатися, що екран увімкнений і розблокований."""
    print(f"[*] connecting to {serial} …")
    d = u2.connect(serial)
    print(f"[+] connected: {d.info.get('productName')} "
          f"Android {d.device_info.get('version')} "
          f"({d.info.get('displayWidth')}x{d.info.get('displayHeight')})")
    d.screen_on()
    d.unlock()
    d.press("home")
    return d


def shot(d: u2.Device, name: str) -> Path:
    """Зберегти скріншот у папку shots/ і повернути шлях."""
    p = SHOTS / f"{name}.png"
    d.screenshot(str(p))
    print(f"    · screenshot → {p}")
    return p


def install_apk(d: u2.Device, apk: str) -> None:
    """Встановити APK (локальний шлях або URL). Для x86_64-образу потрібен x86/universal APK."""
    print(f"[*] installing {apk} …")
    d.app_install(apk)              # приймає і локальний файл, і http(s)-URL
    print("[+] installed")


def launch(d: u2.Device, package: str) -> None:
    """Запустити застосунок за іменем пакета й дочекатися, поки він стане активним."""
    print(f"[*] launching {package} …")
    d.app_start(package, wait=True)
    cur = d.app_current()
    print(f"[+] foreground: {cur.get('package')}/{cur.get('activity')}")


def tap_text(d: u2.Device, text: str, timeout: float = 10) -> bool:
    """Знайти елемент за видимим текстом і натиснути. Повертає True, якщо вдалось."""
    el = d(text=text)
    if el.wait(timeout=timeout):
        el.click()
        print(f"    · tapped '{text}'")
        return True
    print(f"    ! '{text}' not found")
    return False


def type_into(d: u2.Device, resource_id: str, value: str, timeout: float = 10) -> bool:
    """Ввести текст у поле за resourceId (стабільніше за координати)."""
    el = d(resourceId=resource_id)
    if el.wait(timeout=timeout):
        el.click()
        d.send_keys(value, clear=True)
        print(f"    · typed '{value}' into {resource_id}")
        return True
    print(f"    ! field {resource_id} not found")
    return False


# ------------------------------------------------------------------ demo ----
def demo_settings(d: u2.Device) -> None:
    """Демо реальної автоматизації: відкрити Settings, прочитати пункти, зайти в розділ."""
    print("\n=== DEMO: автоматизація застосунку Settings ===")
    launch(d, "com.android.settings")
    time.sleep(1.5)
    shot(d, "01_settings_home")

    # Прочитати видимі пункти верхнього рівня (демонстрація читання UI-дерева)
    titles = [el.text for el in d.xpath('//*[@resource-id="android:id/title"]').all() if el.text]
    print(f"    · верхні пункти Settings: {titles[:8]}")

    # Зайти в перший осмислений розділ, який знайдемо
    for candidate in ("Display", "Network & internet", "System", "Battery", "Sound"):
        if d(text=candidate).exists:
            tap_text(d, candidate)
            time.sleep(1.5)
            shot(d, "02_settings_section")
            break

    d.press("back")
    time.sleep(1)

    # Пошук усередині Settings (демонстрація вводу тексту)
    if d(resourceId="com.android.settings:id/search_action_bar_title").exists:
        d(resourceId="com.android.settings:id/search_action_bar_title").click()
        time.sleep(1)
        # поле вводу в екрані пошуку
        if d(resourceId="android:id/search_src_text").exists:
            d.send_keys("wifi", clear=True)
            print("    · ввів 'wifi' у пошук Settings")
            time.sleep(1.5)
            shot(d, "03_settings_search")

    d.press("home")
    print("=== demo done ===\n")


# ------------------------------------------------------------------ main ----
def main() -> int:
    ap = argparse.ArgumentParser(description="Android automation via uiautomator2")
    ap.add_argument("--serial", default="emulator-5554", help="adb serial (default: emulator-5554)")
    ap.add_argument("--install", metavar="APK", help="встановити APK (файл або URL) і вийти")
    ap.add_argument("--launch", metavar="PACKAGE", help="запустити застосунок і вийти")
    ap.add_argument("--list", action="store_true", help="показати встановлені сторонні застосунки")
    args = ap.parse_args()

    try:
        d = connect(args.serial)
    except Exception as exc:  # noqa: BLE001
        print(f"[!] не вдалося підключитись: {exc}")
        print("    перевір: `adb devices` показує пристрій і він 'device', не 'offline'.")
        return 2

    if args.list:
        pkgs = d.app_list(filter="-3")  # сторонні (user-installed)
        print("Сторонні застосунки:", pkgs or "(немає)")
        return 0

    if args.install:
        install_apk(d, args.install)
        return 0

    if args.launch:
        launch(d, args.launch)
        return 0

    demo_settings(d)
    return 0


if __name__ == "__main__":
    sys.exit(main())
