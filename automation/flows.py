"""
Поведінки ('flows') для застосунків на емуляторі.

Поведінка = функція, що приймає підключений u2.Device і параметри та виконує
послідовність {знайти елемент -> дія}. Додати нову поведінку = додати сюди функцію
(і, за бажанням, ендпоінт у bridge.py, щоб викликати її по HTTP / з Node).

Threads малює UI через Litho (декларативний UI Meta), тому стандартні селектори
uiautomator (resourceId/xpath) часто флакають. Надійний підхід, який тут і
використано:
  * читаємо UI-дерево напряму (dump_hierarchy) і беремо координати елемента;
  * тапаємо по координатах (центр bounds);
  * текст шлемо у СФОКУСОВАНЕ поле (send_keys) — композер фокусує поле сам.

Селектори Threads 446:
    вхід у композер : text="What's new?" (або переклад — див. COMPOSER_ENTRY_TEXTS)
    поле тексту     : resource-id .../new_thread_screen_composer  (фокусується само)
    кнопка Post     : resource-id .../new_thread_screen_post_button
                      (текстовий fallback — див. POST_BUTTON_TEXTS)

Якщо на емуляторі змінили мову інтерфейсу — resource-id не ламаються (вони не
залежать від локалі), а текстові селектори ламаються. Якщо постинг почав
валитись з "не знайдено" після зміни локалі — додайте новий переклад у
COMPOSER_ENTRY_TEXTS / POST_BUTTON_TEXTS нижче.

ВАЖЛИВО: автоматична публікація у Threads порушує правила Meta й ризикована для
акаунта. publish=False дає «сухий» прогін (заповнити, але не публікувати).
"""
from __future__ import annotations

import logging
import re
import time
import xml.etree.ElementTree as ET
from typing import Any, Optional

import uiautomator2 as u2

THREADS_PKG = "com.instagram.barcelona"
BROADCAST_IDLE_TIMEOUT = 480

# Текстові підписи залежать від мови інтерфейсу (на відміну від resource-id).
# Додайте сюди переклад, якщо автопостинг знову не знаходить елемент після
# зміни локалі емулятора.
# Мови: англійська, українська, російська.
COMPOSER_ENTRY_TEXTS = ["What’s new?", "What's new?", "Що нового?", "Что нового?"]
POST_BUTTON_TEXTS = ["Post", "Опублікувати", "Поділитися", "Опубликовать", "Поделиться"]
# Снекбар, який Threads показує, коли пост реально дійшов до сервера.
POSTED_TEXTS = ["Posted", "Опубліковано", "Опубликовано"]
PUBLISH_CONFIRM_TIMEOUT = 90

log = logging.getLogger("flows")


# --- робота з UI-деревом напряму (стійко до Litho) --------------------------
# ВАЖЛИВО: Threads/Litho задають resource-id БЕЗ префікса пакета (просто
# 'new_thread_screen_composer'), тому resource_id порівнюємо за останнім сегментом
# — працює і для 'pkg:id/name', і для голого 'name'.
def _seg(s: str) -> str:
    return s.split("/")[-1]


def _find(d: u2.Device, **attrs) -> Optional[dict[str, str]]:
    """Перший node у dump_hierarchy, що збігається за наданими атрибутами.

    `text=` можна передати і списком/кортежем — тоді підходить збіг з БУДЬ-ЯКИМ
    варіантом зі списку. Це потрібно, бо текстові підписи (на відміну від
    resource-id) залежать від мови інтерфейсу застосунку/емулятора — якщо
    локаль змінили (напр. на українську), "What's new?" стає "Що нового?",
    тож пошук тільки за однією жорсткою строкою ламається.
    """
    root = ET.fromstring(d.dump_hierarchy())
    for n in root.iter("node"):
        a = n.attrib
        ok = True
        for k, v in attrs.items():
            if k == "resource_id":
                if _seg(a.get("resource-id", "")) != _seg(v):
                    ok = False
                    break
            elif k == "text" and isinstance(v, (list, tuple, set)):
                if a.get("text", "") not in v:
                    ok = False
                    break
            elif a.get(k.replace("_", "-"), "") != v:
                ok = False
                break
        if ok:
            return dict(a)
    return None


def _wait(d: u2.Device, timeout: float = 20, **attrs: str) -> Optional[dict[str, str]]:
    end = time.time() + timeout
    while time.time() < end:
        node = _find(d, **attrs)
        if node:
            return node
        time.sleep(0.4)
    return None


def _center(bounds: str) -> tuple[int, int]:
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", bounds)[:4])
    return (x1 + x2) // 2, (y1 + y2) // 2


def _tap(d: u2.Device, node: dict[str, str]) -> None:
    d.click(*_center(node["bounds"]))


# --- екран / блокування (важливо для фізичних телефонів) ---------------------
# На емуляторі екран завжди увімкнений і без блокування; справжній телефон гасне
# й показує локскрін. Ключі в dumpsys відрізняються між версіями Android, тож
# перевіряємо кілька: будь-який з них =true означає, що локскрін на екрані.
KEYGUARD_CMD = (
    "dumpsys window | grep -E 'mDreamingLockscreen|mShowingLockscreen|isStatusBarKeyguard'; "
    "dumpsys activity activities | grep -m1 -E 'mKeyguardShowing'"
)
_KEYGUARD_RE = re.compile(r"(?:Lockscreen|Keyguard|KeyguardShowing)=true")


def keyguard_showing(shell_output: str) -> bool:
    return bool(_KEYGUARD_RE.search(shell_output or ""))


def ensure_awake(d: u2.Device) -> None:
    """Увімкнути екран і зняти блокування свайпом. Якщо після свайпу локскрін
    лишився — на телефоні PIN/пароль/візерунок, і автоматизація неможлива."""
    d.screen_on()
    time.sleep(0.5)
    if not keyguard_showing(d.shell(KEYGUARD_CMD, timeout=10).output):
        return
    for _ in range(2):
        d.swipe_ext("up", scale=0.8)
        time.sleep(1.2)
        if not keyguard_showing(d.shell(KEYGUARD_CMD, timeout=10).output):
            log.info("[%s] screen unlocked by swipe", d.serial)
            return
    raise RuntimeError(
        "телефон заблокований (PIN/пароль/візерунок) — вимкніть блокування екрана "
        "або розблокуйте його вручну"
    )


# --- поведінка: пост у Threads ----------------------------------------------
def _app_crash(d: u2.Device) -> str:
    """Перший рядок причини краху Threads з crash-буфера logcat (порожньо, якщо не падав)."""
    try:
        out = d.shell("logcat -d -b crash", timeout=10).output
    except Exception:  # noqa: BLE001
        return ""
    if THREADS_PKG not in out:
        return ""
    for line in out.splitlines():
        if "OutOfMemoryError" in line:
            return ("OutOfMemoryError — замалий ліміт пам'яті застосунку; "
                    "перезапустіть телефон через ManyFaces (він виправляє ліміт при старті)")
    for line in out.splitlines():
        if "Exception" in line or "Error" in line:
            return line.split("AndroidRuntime:", 1)[-1].strip()[:200]
    return "невідома причина (див. adb logcat -b crash)"


def threads_post(d: u2.Device, text: str, publish: bool = True, timeout: float = 20) -> dict[str, Any]:
    """Створити пост у Threads.

    Кроки: відкрити застосунок -> тап 'What's new?' -> ввести текст -> 'Post'.
    publish=False -> заповнити композер, але НЕ публікувати (безпечний тест).
    """
    t0 = time.monotonic()

    def step(msg: str, *args: Any) -> None:
        log.info("[%s +%.1fs] " + msg, d.serial, time.monotonic() - t0, *args)

    ensure_awake(d)

    # Після холодного старту Android хвилинами розсилає системні broadcast-и; текст
    # для AdbKeyboard іде тією ж чергою і до її звільнення просто не доходить.
    step("waiting for broadcast queue idle")
    try:
        d.shell("am wait-for-broadcast-idle", timeout=BROADCAST_IDLE_TIMEOUT)
        step("broadcast queue idle")
    except Exception as exc:  # noqa: BLE001
        step("broadcast idle wait gave up: %s", exc)

    # чистий старт: перезапускаємо застосунок, щоб гарантовано опинитись у стрічці
    # (інакше 'What's new?' може вказувати на вже відкритий/закритий композер).
    d.app_stop(THREADS_PKG)
    time.sleep(1.0)
    try:
        d.shell("logcat -b crash -c", timeout=10)
    except Exception:  # noqa: BLE001
        pass
    d.app_start(THREADS_PKG, wait=True)
    time.sleep(3.0)
    step("app started, foreground=%s", d.app_current().get("package"))

    # 1) відкрити композер
    entry = _wait(d, timeout=timeout, text=COMPOSER_ENTRY_TEXTS)
    if not entry:
        step("composer entry NOT found, foreground=%s", d.app_current().get("package"))
        crash = _app_crash(d)
        if crash:
            step("Threads crashed: %s", crash)
            raise RuntimeError(f"Threads впав після запуску: {crash}")
        raise RuntimeError(
            f"вхід у композер не знайдено (жоден з варіантів: {COMPOSER_ENTRY_TEXTS})"
        )
    _tap(d, entry)
    step("tapped composer entry %r", entry.get("text"))

    # 2) дочекатись поля композера (воно само отримує фокус) і ввести текст
    field = _wait(d, timeout=timeout, resource_id="new_thread_screen_composer")
    if not field:
        step("composer NOT opened, foreground=%s", d.app_current().get("package"))
        raise RuntimeError("композер не відкрився (new_thread_screen_composer)")
    step("composer opened")
    time.sleep(1.0)                      # дати клавіатурі піднятись
    d.send_keys(text, clear=True)        # у сфокусоване поле
    time.sleep(0.8)

    typed = _find(d, resource_id="new_thread_screen_composer")
    typed_text = typed.get("text") if typed else None
    step("typed %d chars, field has %s chars", len(text), len(typed_text) if typed_text else 0)

    if not publish:
        step("dry run done")
        return {"status": "drafted", "text": text, "typed": typed_text}

    # 3) натиснути 'Post' (клік по координатах)
    post = _wait(d, timeout=timeout, resource_id="new_thread_screen_post_button")
    if not post:
        post = _wait(d, timeout=5, text=POST_BUTTON_TEXTS)
        if not post:
            step("post button NOT found")
            raise RuntimeError(f"кнопку 'Post' не знайдено (variants: {POST_BUTTON_TEXTS})")
    _tap(d, post)
    step("tapped post button, waiting for confirmation")
    # Тап лише ставить пост у чергу завантаження; якщо одразу закрити застосунок
    # чи емулятор, Threads довідправить його аж при наступному запуску.
    confirmed = _wait(d, timeout=PUBLISH_CONFIRM_TIMEOUT, text=POSTED_TEXTS) is not None
    step("publish confirmed=%s", confirmed)
    return {"status": "posted", "text": text, "confirmed": confirmed}


# --- поведінка: метрики дописів зі «Статистики» Threads ---------------------
# Шлях: вкладка Профіль (resource-id barcelona_tab_profile, не залежить від мови)
# -> кнопка «Статистика» (іконка вгорі зліва) -> вкладка «Огляд», блок «Дописи».
# Кожен рядок блоку — клікабельний контейнер з:
#   * текстом допису, урізаним самим Threads: '⁨<початок>⁩… 3 д.';
#   * чотирма лічильниками в один ряд під текстом (зліва направо):
#     лайки, відповіді, репости, поширення;
#   * кількістю переглядів праворуч над підписом «Перегляди».
# Threads показує тут лише ~8 останніх дописів (за 90 днів) — саме ті, у яких
# цифри ще ростуть.
PROFILE_TAB_ID = "barcelona_tab_profile"
INSIGHTS_DESCS = ["Статистика", "Insights"]  # «Статистика» однакова в uk і ru
INSIGHTS_BUTTON_TEXTS = ["Переглянути статистику", "View insights", "Посмотреть статистику"]
VIEWS_LABELS = {"Перегляди", "Views", "Просмотры"}
METRICS_MAX_SWIPES = 8

_BOUNDS_RE = re.compile(r"\d+")
_ISOLATED_RE = re.compile("⁨(.*?)⁩", re.S)


def _bounds(node: ET.Element) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = map(int, _BOUNDS_RE.findall(node.attrib.get("bounds", ""))[:4])
    return x1, y1, x2, y2


def parse_count(s: str) -> Optional[int]:
    """'17' -> 17, '1,2 тис.' / '1,2 тыс.' -> 1200, '3.4K' -> 3400, '2 млн' -> 2000000."""
    t = s.strip().lower().replace("\xa0", " ").replace(" ", " ")
    m = re.match(r"^(\d+(?:[.,]\d+)?)\s*(тис\.?|тыс\.?|k|млн\.?|m)?$", t)
    if not m:
        return None
    num = float(m.group(1).replace(",", "."))
    mult = {"тис": 1_000, "тыс": 1_000, "k": 1_000, "млн": 1_000_000, "m": 1_000_000}.get(
        (m.group(2) or "").rstrip("."), 1)
    return int(round(num * mult))


def _row_text(raw: str) -> str:
    """Текст допису з рядка статистики без ізоляторів, '…' і віку ('3 д.')."""
    m = _ISOLATED_RE.search(raw)
    text = m.group(1) if m else raw
    return " ".join(text.split())


def _insights_rows(xml: str) -> list[dict[str, Any]]:
    """Розібрати видимі рядки блоку «Дописи» з дампу UI."""
    root = ET.fromstring(xml)
    rows = []
    for row in root.iter("node"):
        if row.attrib.get("clickable") != "true":
            continue
        kids = [n for n in row.iter("node") if n is not row]
        texts = [n for n in kids if n.attrib.get("text")]
        if not any(n.attrib["text"] in VIEWS_LABELS for n in texts):
            continue
        body = [n for n in texts if parse_count(n.attrib["text"]) is None
                and n.attrib["text"] not in VIEWS_LABELS]
        nums = [(n, parse_count(n.attrib["text"])) for n in texts
                if parse_count(n.attrib["text"]) is not None]
        if not body or len(nums) < 5:
            continue  # рядок обрізаний краєм екрана — доберемо після свайпу
        label = next(n for n in texts if n.attrib["text"] in VIEWS_LABELS)
        lx1 = _bounds(label)[0]
        views = [v for n, v in nums if _bounds(n)[0] >= lx1]
        counters = sorted(((_bounds(n)[0], v) for n, v in nums if _bounds(n)[0] < lx1))
        if len(views) != 1 or len(counters) != 4:
            continue
        likes, replies, reposts, shares = (v for _, v in counters)
        rows.append({
            "text": _row_text(max(body, key=lambda n: len(n.attrib["text"])).attrib["text"]),
            "views": views[0], "likes": likes, "replies": replies,
            "reposts": reposts, "shares": shares,
        })
    return rows


def threads_metrics(d: u2.Device, timeout: float = 20) -> dict[str, Any]:
    """Зібрати метрики останніх дописів акаунта зі «Статистики» Threads.

    Нічого не публікує й не змінює — лише відкриває екрани та читає цифри.
    Повертає {"posts": [{text, views, likes, replies, reposts, shares}, ...]}
    у порядку «Останні» (найновіші першими); text — початок допису, як його
    урізав Threads.
    """
    t0 = time.monotonic()

    def step(msg: str, *args: Any) -> None:
        log.info("[%s +%.1fs] " + msg, d.serial, time.monotonic() - t0, *args)

    ensure_awake(d)
    d.app_stop(THREADS_PKG)
    time.sleep(1.0)
    d.app_start(THREADS_PKG, wait=True)
    time.sleep(3.0)
    step("app started, foreground=%s", d.app_current().get("package"))

    tab = _wait(d, timeout=timeout, resource_id=PROFILE_TAB_ID)
    if not tab:
        crash = _app_crash(d)
        if crash:
            raise RuntimeError(f"Threads впав після запуску: {crash}")
        raise RuntimeError(f"вкладку профілю не знайдено ({PROFILE_TAB_ID})")
    _tap(d, tab)
    step("profile tab opened")

    entry = None
    end = time.time() + timeout
    while time.time() < end and not entry:
        for desc in INSIGHTS_DESCS:
            entry = _find(d, content_desc=desc, clickable="true")
            if entry:
                break
        if not entry:
            entry = _find(d, text=INSIGHTS_BUTTON_TEXTS)
        if not entry:
            time.sleep(0.5)
    if not entry:
        raise RuntimeError(f"кнопку статистики не знайдено ({INSIGHTS_DESCS + INSIGHTS_BUTTON_TEXTS})")
    _tap(d, entry)
    step("insights opened")
    time.sleep(3.0)  # графіки й список довантажуються з мережі

    found: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    stale = 0
    for i in range(METRICS_MAX_SWIPES + 1):
        rows = _insights_rows(d.dump_hierarchy())
        new = 0
        for r in rows:
            if r["text"] not in found:
                order.append(r["text"])
                new += 1
            found[r["text"]] = r
        # Список дописів — кінець екрана: якщо він уже почався і свайп нічого
        # нового не дав, ми внизу.
        stale = stale + 1 if (found and not new) else 0
        if stale >= 2:
            break
        if i < METRICS_MAX_SWIPES:
            d.swipe_ext("up", scale=0.6)
            time.sleep(1.2)
    posts = [found[t] for t in order]
    step("collected %d posts", len(posts))
    if not posts:
        raise RuntimeError("у «Статистиці» не знайдено жодного допису (блок «Дописи» порожній або змінилась розмітка)")
    return {"posts": posts}


# --- реєстр поведінок -------------------------------------------------------
REGISTRY = {"threads_post": threads_post, "threads_metrics": threads_metrics}


if __name__ == "__main__":
    import sys
    text = sys.argv[1] if len(sys.argv) > 1 else "Hello from automation"
    publish = "--dry" not in sys.argv
    dev = u2.connect("emulator-5554")
    print(threads_post(dev, text, publish=publish))
