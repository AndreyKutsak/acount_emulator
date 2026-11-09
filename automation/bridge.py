"""
Android automation bridge — HTTP API поверх uiautomator2.

Твій Node-бекенд (або будь-що) керує емулятором через прості HTTP-запити.
Запуск:
    .venv\\Scripts\\python.exe bridge.py            # http://127.0.0.1:8900
    ANDROID_BRIDGE_PORT=8901 ... bridge.py          # інший порт
    ANDROID_SERIAL=emulator-5556 ... bridge.py      # інший пристрій за замовчуванням

Ендпоінти (усі під /):
    GET  /health                      — живий + поточний пристрій
    GET  /devices                     — список adb-пристроїв
    GET  /info                        — інфо про пристрій
    POST /app/install  {source}       — встановити APK (локальний шлях або http-URL)
    POST /app/start    {package}      — запустити застосунок
    POST /app/stop     {package}      — зупинити застосунок
    GET  /app/current                 — який застосунок на передньому плані
    GET  /apps?third_party=true       — список застосунків
    POST /tap_text     {text}         — натиснути елемент за видимим текстом
    POST /tap          {x, y}         — тап по координатах
    POST /type         {text, resource_id?} — ввести текст (у поле за id або активне)
    POST /press        {key}          — апаратна клавіша (home/back/enter/…)
    POST /swipe        {direction}    — свайп up/down/left/right
    GET  /screenshot                  — PNG поточного екрана
    GET  /hierarchy                   — XML усього UI-дерева
"""
from __future__ import annotations

import io
import os
import threading
from typing import Any, Optional

import uiautomator2 as u2
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from pathlib import Path as _Path
from pydantic import BaseModel

import flows  # готові поведінки (threads_post, ...)
import device_profile  # профіль маскування пристрою (Шар A/Б)

DEFAULT_SERIAL = os.environ.get("ANDROID_SERIAL", "emulator-5554")
HOST = os.environ.get("ANDROID_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("ANDROID_BRIDGE_PORT", "8900"))

app = FastAPI(title="Android automation bridge")

# Один підключений пристрій на serial, щоб не перепідключатись на кожен запит.
_devices: dict[str, u2.Device] = {}
# Лок ОКРЕМО на кожен serial, а не один спільний: якщо підключення до одного
# пристрою зависло (наприклад, adb намагається знайти вже неіснуючий серіал і
# довго ретраїть зсередини uiautomator2), запити до ІНШОГО серіала/пристрою не
# мають через це стояти в черзі.
_locks_guard = threading.Lock()
_serial_locks: dict[str, threading.Lock] = {}


def _lock_for(serial: str) -> threading.Lock:
    with _locks_guard:
        lk = _serial_locks.get(serial)
        if lk is None:
            lk = _serial_locks[serial] = threading.Lock()
        return lk


def _serial_present(serial: str) -> bool:
    """Швидка перевірка в `adb devices`, без ретраїв uiautomator2."""
    import adbutils

    try:
        return any(d.serial == serial for d in adbutils.adb.device_list())
    except Exception:  # noqa: BLE001
        return False


def dev(serial: Optional[str] = None) -> u2.Device:
    """Повернути (за потреби — створити) підключення до пристрою.

    Кешований u2.Device прив'язаний до HTTP-сесії atx-agent КОНКРЕТНОГО
    процесу емулятора. Серіал (emulator-5554) переживає перезапуск AVD, а
    агент на новому процесі — ні: стара сесія висить мертвим кешем і будь-який
    RPC-виклик (dump_hierarchy, клік, ...) валиться з "Remote end closed
    connection without response". Тому перед тим як повернути кеш, дешево
    перевіряємо, що агент ще живий, і якщо ні — викидаємо кеш і підключаємось
    заново.

    Якщо серіала взагалі немає в `adb devices` — одразу 503, а не чекаємо, бо
    u2.connect()/Device.__init__ усередині ретраять і можуть зависати на
    десятки секунд (і тримати лок) замість швидкого фейла.
    """
    s = serial or DEFAULT_SERIAL
    with _lock_for(s):
        d = _devices.get(s)
        if d is not None:
            try:
                d.info  # noqa: B018 - свідомий health-check через RPC
            except Exception:  # noqa: BLE001
                _devices.pop(s, None)
                d = None
        if d is None:
            if not _serial_present(s):
                raise HTTPException(503, f"device {s} не підключений (adb devices порожній для цього серіала)")
            try:
                d = u2.connect(s)
                d.screen_on()
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(503, f"cannot connect to {s}: {exc}")
            _devices[s] = d
        return d


# ------------------------------------------------------------- models ----
class InstallBody(BaseModel):
    source: str                    # локальний шлях або http(s)-URL до APK
    serial: Optional[str] = None


class PackageBody(BaseModel):
    package: str
    serial: Optional[str] = None


class TapTextBody(BaseModel):
    text: str
    timeout: float = 10
    serial: Optional[str] = None


class TapBody(BaseModel):
    x: int
    y: int
    serial: Optional[str] = None


class TypeBody(BaseModel):
    text: str
    resource_id: Optional[str] = None
    clear: bool = True
    serial: Optional[str] = None


class PressBody(BaseModel):
    key: str = "home"              # home/back/enter/menu/power/recent/volume_up…
    serial: Optional[str] = None


class SwipeBody(BaseModel):
    direction: str = "up"          # up/down/left/right
    serial: Optional[str] = None


# ------------------------------------------------------------- routes ----
_PANEL = _Path(__file__).parent / "panel.html"


@app.get("/")
def panel() -> FileResponse:
    """Візуальна панель керування (no-code): клік-у-тап, кнопки, запуск/встановлення, запис дій."""
    return FileResponse(str(_PANEL))


@app.get("/health")
def health() -> dict[str, Any]:
    serial = DEFAULT_SERIAL
    try:
        d = dev(serial)
        return {"ok": True, "serial": serial, "connected": True,
                "current": d.app_current().get("package")}
    except HTTPException:
        return {"ok": True, "serial": serial, "connected": False}


@app.get("/devices")
def devices() -> dict[str, Any]:
    import adbutils
    out = []
    for dv in adbutils.adb.device_list():
        out.append({"serial": dv.serial, "state": "device"})
    return {"devices": out, "default": DEFAULT_SERIAL}


@app.get("/info")
def info(serial: Optional[str] = None) -> dict[str, Any]:
    d = dev(serial)
    di = d.device_info
    i = d.info
    return {
        "serial": d.serial,
        "brand": di.get("brand"),
        "model": di.get("model"),
        "android_version": di.get("version"),
        "sdk": di.get("sdk"),
        "arch": di.get("arch"),
        "width": i.get("displayWidth"),
        "height": i.get("displayHeight"),
        "battery": di.get("battery"),
    }


def _install_split_bundle(serial: str, bundle: str) -> None:
    """XAPK/APKS = zip of split APKs -> extract and `adb install-multiple`."""
    import subprocess
    import tempfile
    import zipfile

    import adbutils

    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(bundle) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".apk") and "/" not in n]
            if not names:
                raise RuntimeError("no .apk files in bundle root")
            for n in names:
                z.extract(n, tmp)
        paths = [os.path.join(tmp, n) for n in names]
        cmd = [adbutils.adb_path(), "-s", serial, "install-multiple", "-r", "-d", *paths]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if r.returncode != 0 or "Success" not in r.stdout:
            raise RuntimeError((r.stdout + r.stderr).strip())


@app.post("/app/install")
def app_install(body: InstallBody) -> dict[str, Any]:
    d = dev(body.serial)
    try:
        if body.source.lower().endswith((".xapk", ".apks", ".apkm")):
            _install_split_bundle(d.serial, body.source)
        else:
            d.app_install(body.source)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"install failed: {exc}")
    return {"installed": True, "source": body.source}


@app.post("/app/start")
def app_start(body: PackageBody) -> dict[str, Any]:
    d = dev(body.serial)
    d.app_start(body.package, wait=True)
    return {"started": body.package, "current": d.app_current()}


@app.post("/app/stop")
def app_stop(body: PackageBody) -> dict[str, Any]:
    d = dev(body.serial)
    d.app_stop(body.package)
    return {"stopped": body.package}


@app.get("/app/current")
def app_current(serial: Optional[str] = None) -> dict[str, Any]:
    return dev(serial).app_current()


@app.get("/apps")
def apps(third_party: bool = True, serial: Optional[str] = None) -> dict[str, Any]:
    d = dev(serial)
    return {"packages": d.app_list(filter="-3" if third_party else None)}


@app.post("/tap_text")
def tap_text(body: TapTextBody) -> dict[str, Any]:
    d = dev(body.serial)
    el = d(text=body.text)
    if not el.wait(timeout=body.timeout):
        raise HTTPException(404, f"element with text '{body.text}' not found")
    el.click()
    return {"tapped": body.text}


@app.post("/tap")
def tap(body: TapBody) -> dict[str, Any]:
    dev(body.serial).click(body.x, body.y)
    return {"tapped": [body.x, body.y]}


@app.post("/type")
def type_text(body: TypeBody) -> dict[str, Any]:
    d = dev(body.serial)
    if body.resource_id:
        el = d(resourceId=body.resource_id)
        if not el.wait(timeout=10):
            raise HTTPException(404, f"field {body.resource_id} not found")
        el.click()
    d.send_keys(body.text, clear=body.clear)
    return {"typed": body.text}


@app.post("/press")
def press(body: PressBody) -> dict[str, Any]:
    dev(body.serial).press(body.key)
    return {"pressed": body.key}


@app.post("/swipe")
def swipe(body: SwipeBody) -> dict[str, Any]:
    dev(body.serial).swipe_ext(body.direction)
    return {"swiped": body.direction}


class ThreadsPostBody(BaseModel):
    text: str
    publish: bool = True          # False = заповнити композер, але НЕ публікувати
    serial: Optional[str] = None


@app.post("/behavior/threads-post")
def behavior_threads_post(body: ThreadsPostBody) -> dict[str, Any]:
    """Поведінка: створити пост у Threads (див. flows.threads_post)."""
    d = dev(body.serial)
    try:
        return flows.threads_post(d, body.text, publish=body.publish)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"threads_post: {exc}")


# ----------------------------------------- профіль маскування пристрою ----
class DeviceProfileBody(BaseModel):
    profile: Optional[dict[str, Any]] = None
    serial: Optional[str] = None
    key: Optional[str] = None       # ключ сховища (напр. profileId) — per-профіль


@app.get("/device/defaults")
def device_defaults() -> dict[str, Any]:
    """Дефолтні параметри маскування (під Pixel 7)."""
    return device_profile.default_profile()


@app.get("/device/profile")
def device_profile_get(serial: Optional[str] = None, key: Optional[str] = None) -> dict[str, Any]:
    """Збережений профіль за ключем key (per-профіль) або за serial (інакше дефолтний)."""
    store_key = key or serial or DEFAULT_SERIAL
    return {"key": store_key, "serial": serial or DEFAULT_SERIAL,
            "profile": device_profile.get_profile(store_key)}


@app.put("/device/profile")
def device_profile_put(body: DeviceProfileBody) -> dict[str, Any]:
    """Зберегти (відредагований) профіль за ключем key (per-профіль) або за serial."""
    store_key = body.key or body.serial or DEFAULT_SERIAL
    if not body.profile:
        raise HTTPException(400, "profile обов'язковий")
    return {"key": store_key, "profile": device_profile.save_profile(store_key, body.profile)}


@app.get("/device/current")
def device_current(serial: Optional[str] = None) -> dict[str, Any]:
    """Фактичні параметри, прочитані з пристрою (що бачать застосунки)."""
    return device_profile.read_current(serial or DEFAULT_SERIAL)


@app.post("/device/apply")
def device_apply(body: Optional[DeviceProfileBody] = None) -> dict[str, Any]:
    """Застосувати профіль до запущеного пристрою (повертає по-полевий статус).

    serial — adb-ціль; key — ключ сховища (per-профіль), якщо profile не передано.
    """
    serial = (body.serial if body else None) or DEFAULT_SERIAL
    prof = body.profile if (body and body.profile) else None
    key = body.key if body else None
    try:
        return device_profile.apply_profile(serial, prof, key=key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"device apply: {exc}")


@app.post("/device/apply-persistent")
def device_apply_persistent(body: Optional[DeviceProfileBody] = None) -> dict[str, Any]:
    """Повна підміна ro.*-пропсів через /system/build.prop + ребут (надовго).

    Модифікує системний розділ і перезавантажує емулятор. serial — adb-ціль;
    key — ключ сховища (per-профіль), якщо profile не передано.
    """
    serial = (body.serial if body else None) or DEFAULT_SERIAL
    prof = body.profile if (body and body.profile) else None
    key = body.key if body else None
    try:
        return device_profile.apply_persistent(serial, prof, key=key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"device apply-persistent: {exc}")


class MediaBody(BaseModel):
    source: str                    # локальний шлях на хості моста (фото/відео)
    serial: Optional[str] = None
    dest_dir: Optional[str] = None


@app.post("/media/push")
def media_push(body: MediaBody) -> dict[str, Any]:
    """Залити фото/відео з ПК у галерею пристрою (з медіа-скануванням)."""
    serial = body.serial or DEFAULT_SERIAL
    dest_dir = body.dest_dir or "/sdcard/DCIM/Camera"
    try:
        r = device_profile.push_media(serial, body.source, dest_dir)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"media push: {exc}")
    if not r.get("ok"):
        raise HTTPException(400, r.get("error") or "media push failed")
    return r


@app.get("/screenshot")
def screenshot(serial: Optional[str] = None) -> Response:
    img = dev(serial).screenshot()        # PIL.Image
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@app.get("/hierarchy")
def hierarchy(serial: Optional[str] = None) -> Response:
    xml = dev(serial).dump_hierarchy()
    return Response(content=xml, media_type="application/xml")


if __name__ == "__main__":
    import uvicorn
    print(f"Android bridge on http://{HOST}:{PORT}  (device: {DEFAULT_SERIAL})")
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
