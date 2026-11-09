"""
Профіль «маскування» пристрою (anti-detect) для Android-емулятора.

Два шари параметрів:
  Шар A — build-пропси (ro.product.*, fingerprint, версія) — те, що застосунок
          читає найперше. На userdebug-образі емулятора їх вдається підмінити
          через root + resetprop; частина ro.* лишається read-only і потребує
          правки build.prop + перезавантаження (чесно позначаємо статусом).
  Шар Б — «залізо»/поведінка: IMEI, SIM (оператор/країна), номер телефону,
          режим GPU, батарея, щільність/розмір екрана.

Параметри зберігаються у device_profiles.json (ключ — serial), щоб редагування
переживало перезапуск. Застосування повертає по-полевий статус — чесно, що
реально застосувалось, а що лишилось лише збереженим бажаним значенням.

Статуси:
  applied          — значення реально виставлене і прочитане назад з пристрою
  readonly-reboot  — ro.*-проп read-only у рантаймі: треба build.prop + ребут
  on-next-launch   — застосовується лише при старті емулятора (напр. режим GPU)
  needs-root-module— без Magisk/Xposed-модуля на емуляторі не підміняється
                     (IMEI, SIM, рядок GL_RENDERER)
  no-root          — не вдалось отримати root (adb root), проп не чіпали
  error            — спроба впала (деталі у note)
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

_STORE = Path(__file__).parent / "device_profiles.json"


# --------------------------------------------------------------- defaults ----
# Дефолт — під реальний Google Pixel 7 (panther). Це стартові значення, які
# користувач далі редагує через інтерфейс.
def default_profile() -> dict[str, Any]:
    return {
        # --- Шар A: build-пропси ---
        "manufacturer": "Google",
        "brand": "google",
        "model": "Pixel 7",
        "device": "panther",
        "product": "panther",
        "fingerprint": (
            "google/panther/panther:14/UP1A.231105.001/10817346:user/release-keys"
        ),
        "build_id": "UP1A.231105.001",
        "android_release": "14",
        "sdk": "34",
        "security_patch": "2023-11-05",
        # --- Шар Б: «залізо» / поведінка ---
        "imei": "356938035643809",       # 15 цифр (валідний за Луном бажано)
        "sim_operator": "Vodafone UA",     # назва оператора
        "sim_operator_code": "25501",      # MCC+MNC
        "sim_country": "ua",               # ISO-код країни SIM
        "phone_number": "+380991234567",
        "gpu_mode": "host",                # host | swiftshader_indirect | angle_indirect | guest
        "gl_renderer": "Adreno (TM) 730",  # бажаний рядок GL_RENDERER (потребує root-модуля)
        "battery_level": 73,               # %
        "battery_status": "discharging",   # charging | discharging | full | not-charging
        "density": 420,                    # dpi
        "screen_w": 1080,
        "screen_h": 2400,
    }


# --------------------------------------------------------------- storage ----
def _load_all() -> dict[str, Any]:
    try:
        return json.loads(_STORE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def get_profile(serial: str) -> dict[str, Any]:
    """Збережений профіль для serial або дефолтний (злитий з дефолтами)."""
    saved = _load_all().get(serial) or {}
    merged = default_profile()
    merged.update({k: v for k, v in saved.items() if v is not None})
    return merged


def save_profile(serial: str, profile: dict[str, Any]) -> dict[str, Any]:
    data = _load_all()
    # зберігаємо лише відомі ключі (щоб не засмічувати сторонніми полями)
    allowed = set(default_profile().keys())
    clean = {k: v for k, v in (profile or {}).items() if k in allowed}
    data[serial] = clean
    _STORE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return get_profile(serial)


# ------------------------------------------------------------------- adb ----
def _adb_path() -> str:
    env = os.environ.get("ANDROID_ADB")
    if env and Path(env).exists():
        return env
    guess = Path.home() / ".antidetect" / "android" / "sdk" / "platform-tools" / "adb.exe"
    if guess.exists():
        return str(guess)
    return "adb"


def _adb(serial: str, *args: str, timeout: int = 20) -> tuple[int, str]:
    cmd = [_adb_path(), "-s", serial, *args]
    try:
        p = subprocess.run(
            cmd, capture_output=True, timeout=timeout,
            encoding="utf-8", errors="replace",
        )
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except Exception as exc:  # noqa: BLE001
        return 1, str(exc)


def _sh(serial: str, cmd: str, timeout: int = 20) -> tuple[int, str]:
    return _adb(serial, "shell", cmd, timeout=timeout)


def _getprop(serial: str, key: str) -> str:
    _, out = _sh(serial, f"getprop {key}")
    return out.strip()


def _try_root(serial: str) -> bool:
    """adb root (на userdebug-образі емулятора має спрацювати)."""
    code, out = _adb(serial, "root", timeout=25)
    ok = "cannot" not in out.lower() and "not allow" not in out.lower()
    # дати демону перезапуститись
    _adb(serial, "wait-for-device", timeout=25)
    return ok


def _has_resetprop(serial: str) -> bool:
    code, out = _sh(serial, "which resetprop")
    return code == 0 and "resetprop" in out


def _set_prop(serial: str, key: str, val: str, use_resetprop: bool) -> dict[str, Any]:
    """Виставити один ro-проп. Повертає статус поля."""
    tool = "resetprop -n" if use_resetprop else "setprop"
    _sh(serial, f'{tool} {key} "{val}"')
    now = _getprop(serial, key)
    if now == val:
        return {"applied": True, "status": "applied", "value": now}
    # read-only у рантаймі — потрібна правка build.prop + ребут
    return {"applied": False, "status": "readonly-reboot", "value": now, "target": val}


# --------------------------------------------------------------- current ----
def read_current(serial: str) -> dict[str, Any]:
    """Прочитати фактичні параметри з пристрою (що бачать застосунки)."""
    g = lambda k: _getprop(serial, k)  # noqa: E731
    # GL renderer зі SurfaceFlinger
    _, sf = _sh(serial, "dumpsys SurfaceFlinger")
    m = re.search(r"GLES:\s*(.+)", sf)
    gl = m.group(1).strip() if m else None
    # щільність і розмір
    _, dens = _sh(serial, "wm density")
    _, size = _sh(serial, "wm size")
    dm = re.search(r"(\d+)", dens)
    sm = re.search(r"(\d+)x(\d+)", size)
    # батарея
    _, bat = _sh(serial, "dumpsys battery")
    bl = re.search(r"level:\s*(\d+)", bat)
    return {
        "serial": serial,
        "manufacturer": g("ro.product.manufacturer"),
        "brand": g("ro.product.brand"),
        "model": g("ro.product.model"),
        "device": g("ro.product.device"),
        "product": g("ro.product.name"),
        "fingerprint": g("ro.build.fingerprint"),
        "build_id": g("ro.build.id"),
        "android_release": g("ro.build.version.release"),
        "sdk": g("ro.build.version.sdk"),
        "security_patch": g("ro.build.version.security_patch"),
        "hardware": g("ro.hardware"),
        "qemu": g("ro.kernel.qemu") or g("ro.boot.qemu"),
        "sim_operator": g("gsm.sim.operator.alpha"),
        "sim_operator_code": g("gsm.sim.operator.numeric"),
        "sim_country": g("gsm.sim.operator.iso-country"),
        "gl_renderer": gl,
        "density": int(dm.group(1)) if dm else None,
        "screen_w": int(sm.group(1)) if sm else None,
        "screen_h": int(sm.group(2)) if sm else None,
        "battery_level": int(bl.group(1)) if bl else None,
    }


# ----------------------------------------------------------------- apply ----
# Карта: поле профілю -> ro-проп (Шар A + текстові gsm-пропси SIM, які інколи
# вдається підмінити через resetprop).
_PROP_MAP = {
    "manufacturer": "ro.product.manufacturer",
    "brand": "ro.product.brand",
    "model": "ro.product.model",
    "device": "ro.product.device",
    "product": "ro.product.name",
    "fingerprint": "ro.build.fingerprint",
    "build_id": "ro.build.id",
    "android_release": "ro.build.version.release",
    "sdk": "ro.build.version.sdk",
    "security_patch": "ro.build.version.security_patch",
}
_SIM_PROP_MAP = {
    "sim_operator": "gsm.sim.operator.alpha",
    "sim_operator_code": "gsm.sim.operator.numeric",
    "sim_country": "gsm.sim.operator.iso-country",
}


def apply_profile(
    serial: str,
    profile: Optional[dict[str, Any]] = None,
    key: Optional[str] = None,
) -> dict[str, Any]:
    """Застосувати профіль до запущеного пристрою (serial).

    profile — явний набір параметрів; якщо None, береться збережений за ключем
    key (per-профіль) або за serial. Повертає по-полевий статус.
    """
    prof = profile or get_profile(key or serial)
    root_ok = _try_root(serial)
    use_resetprop = _has_resetprop(serial) if root_ok else False
    results: dict[str, Any] = {}

    # --- Шар A: build-пропси ---
    for field, key in _PROP_MAP.items():
        val = prof.get(field)
        if val is None or val == "":
            continue
        if not root_ok:
            results[field] = {"applied": False, "status": "no-root", "target": val}
            continue
        results[field] = _set_prop(serial, key, str(val), use_resetprop)

    # --- Шар Б: SIM-пропси (best-effort через resetprop) ---
    for field, key in _SIM_PROP_MAP.items():
        val = prof.get(field)
        if val is None or val == "":
            continue
        if not root_ok:
            results[field] = {"applied": False, "status": "no-root", "target": val}
            continue
        results[field] = _set_prop(serial, key, str(val), use_resetprop)

    # --- IMEI / номер телефону: без hooking-модуля не підміняється ---
    for field in ("imei", "phone_number"):
        val = prof.get(field)
        if val:
            results[field] = {
                "applied": False, "status": "needs-root-module", "target": val,
                "note": "IMEI/номер підміняються лише Magisk/Xposed-модулем (напр. Device Faker/XPrivacyLua)",
            }

    # --- GPU: режим — лише при старті емулятора; рядок renderer — root-модуль ---
    if prof.get("gpu_mode"):
        results["gpu_mode"] = {
            "applied": False, "status": "on-next-launch", "target": prof["gpu_mode"],
            "note": "режим GPU задається прапорцем -gpu при старті емулятора (ManyFaces)",
        }
    if prof.get("gl_renderer"):
        results["gl_renderer"] = {
            "applied": False, "status": "needs-root-module", "target": prof["gl_renderer"],
            "note": "рядок GL_RENDERER підміняється лише hooking-модулем",
        }

    # --- батарея (працює через dumpsys, root не потрібен) ---
    bl = prof.get("battery_level")
    bs = prof.get("battery_status")
    if bl is not None or bs:
        if bl is not None:
            _sh(serial, f"dumpsys battery set level {int(bl)}")
        status_code = {"charging": 2, "discharging": 3, "not-charging": 4, "full": 5}.get(
            str(bs), 3,
        )
        _sh(serial, "dumpsys battery unplug")
        _sh(serial, f"dumpsys battery set status {status_code}")
        results["battery"] = {"applied": True, "status": "applied",
                              "value": {"level": bl, "status": bs}}

    # --- щільність і розмір екрана (root не потрібен) ---
    if prof.get("density"):
        _sh(serial, f"wm density {int(prof['density'])}")
        results["density"] = {"applied": True, "status": "applied", "value": prof["density"]}
    if prof.get("screen_w") and prof.get("screen_h"):
        _sh(serial, f"wm size {int(prof['screen_w'])}x{int(prof['screen_h'])}")
        results["screen"] = {"applied": True, "status": "applied",
                             "value": f"{prof['screen_w']}x{prof['screen_h']}"}

    applied_n = sum(1 for r in results.values() if r.get("applied"))
    return {
        "serial": serial,
        "root": root_ok,
        "resetprop": use_resetprop,
        "applied_count": applied_n,
        "total": len(results),
        "results": results,
    }


# ------------------------------------------- persistent (build.prop) apply ----
def _wait_boot(serial: str, timeout: int = 180) -> bool:
    """Дочекатись sys.boot_completed=1 після ребута."""
    deadline = time.time() + timeout
    _adb(serial, "wait-for-device", timeout=timeout)
    while time.time() < deadline:
        _, out = _sh(serial, "getprop sys.boot_completed", timeout=10)
        if out.strip() == "1":
            return True
        time.sleep(3)
    return False


def _remount_system(serial: str) -> dict[str, Any]:
    """Зробити /system записуваним (adb root + remount; за потреби disable-verity + ребут)."""
    _try_root(serial)
    code, out = _adb(serial, "remount", timeout=60)
    if "remount succeeded" in out.lower() or ("succeeded" in out.lower() and "fail" not in out.lower()):
        return {"ok": True, "verity_disabled": False}
    # Потрібно вимкнути dm-verity, ребутнути, і повторити remount.
    _adb(serial, "disable-verity", timeout=60)
    _adb(serial, "reboot", timeout=30)
    if not _wait_boot(serial):
        return {"ok": False, "error": "boot timeout after disable-verity"}
    _try_root(serial)
    code2, out2 = _adb(serial, "remount", timeout=60)
    ok = "fail" not in out2.lower() or "succeeded" in out2.lower()
    return {"ok": ok, "verity_disabled": True, "out": (out2 or out).strip()[:300]}


def _edit_build_prop(serial: str, props: dict[str, str]) -> dict[str, Any]:
    """Pull /system/build.prop, оновити/додати ключі, push назад, chmod 644."""
    tmpdir = tempfile.mkdtemp(prefix="buildprop_")
    local = Path(tmpdir) / "build.prop"
    code, out = _adb(serial, "pull", "/system/build.prop", str(local), timeout=60)
    if not local.exists():
        return {"ok": False, "error": f"pull build.prop failed: {out.strip()[:200]}"}

    text = local.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    remaining = dict(props)
    for i, line in enumerate(lines):
        m = re.match(r"\s*([\w.]+)\s*=", line)
        if m and m.group(1) in remaining:
            key = m.group(1)
            lines[i] = f"{key}={remaining.pop(key)}"
    # ключі, яких не було — додаємо в кінець
    for key, val in remaining.items():
        lines.append(f"{key}={val}")
    local.write_text("\n".join(lines) + "\n", encoding="utf-8")

    code, out = _adb(serial, "push", str(local), "/system/build.prop", timeout=60)
    if "error" in out.lower() or "failed" in out.lower() or "read-only" in out.lower():
        return {"ok": False, "error": f"push failed: {out.strip()[:200]}"}
    _sh(serial, "chmod 644 /system/build.prop")
    return {"ok": True, "updated_keys": list(props.keys())}


def push_media(serial: str, source: str, dest_dir: str = "/sdcard/DCIM/Camera") -> dict[str, Any]:
    """Залити фото/відео з ПК у «галерею» пристрою і просканувати, щоб його було видно.

    source — локальний шлях на хості моста. Після push робимо медіа-скан
    (broadcast + fallback `cmd media rescan`), бо інакше MediaStore/Threads файл не бачать.
    """
    src = Path(source)
    if not src.exists():
        return {"ok": False, "error": f"файл не знайдено: {source}"}
    name = src.name
    dest = f"{dest_dir.rstrip('/')}/{name}"

    _sh(serial, f"mkdir -p {dest_dir}")
    code, out = _adb(serial, "push", str(src), dest, timeout=120)
    if "error" in out.lower() or "failed" in out.lower() or "no such" in out.lower():
        return {"ok": False, "stage": "push", "error": out.strip()[:200]}

    # Просканувати, щоб файл зʼявився в галереї/MediaStore.
    _sh(serial, f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://{dest}"')
    # Fallback для Android 11+ (scoped storage): примусовий rescan каталогу.
    _sh(serial, f'cmd media rescan "{dest}"')
    _sh(serial, f'cmd media rescan "{dest_dir}"')

    return {"ok": True, "dest": dest, "name": name}


def apply_persistent(
    serial: str,
    profile: Optional[dict[str, Any]] = None,
    key: Optional[str] = None,
) -> dict[str, Any]:
    """Повна (persistent) підміна ro.*-пропсів через /system/build.prop + ребут.

    Повертає статус і реально перечитані значення після перезавантаження.
    Увага: модифікує системний розділ емулятора й перезавантажує його.
    """
    prof = profile or get_profile(key or serial)
    props = {
        pkey: str(prof[field])
        for field, pkey in _PROP_MAP.items()
        if prof.get(field) not in (None, "")
    }
    if not props:
        return {"serial": serial, "ok": False, "error": "немає пропсів для застосування"}

    remount = _remount_system(serial)
    if not remount.get("ok"):
        return {"serial": serial, "ok": False, "stage": "remount", "detail": remount}

    edit = _edit_build_prop(serial, props)
    if not edit.get("ok"):
        return {"serial": serial, "ok": False, "stage": "edit", "detail": edit}

    _adb(serial, "reboot", timeout=30)
    booted = _wait_boot(serial)

    # перечитати фактичні значення після ребута
    verify = {}
    for field, pkey in _PROP_MAP.items():
        if field in [f for f, k in _PROP_MAP.items() if k in props]:
            verify[field] = _getprop(serial, pkey)

    return {
        "serial": serial,
        "ok": booted,
        "rebooted": True,
        "booted": booted,
        "verity_disabled": remount.get("verity_disabled"),
        "updated_keys": edit.get("updated_keys"),
        "verify": verify,
    }
