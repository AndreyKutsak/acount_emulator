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
import random
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


# Список підказок тем, що з'являється після #тегу в композері.
TOPIC_DISMISS_DESCS = ["Відхилити введення з випередженням", "Dismiss typeahead", "Отклонить ввод с опережением"]
_TRAILING_TAG_RE = re.compile(r"#(\w+)\s*$")


def _pick_topic(d: u2.Device, text: str, step) -> None:
    m = _TRAILING_TAG_RE.search(text or "")
    if not m:
        return
    tag = m.group(1)
    # Підказка - окремий вузол з текстом тегу без «#» (точний збіг регістру,
    # бо нижче Threads показує ще й варіант у нижньому регістрі).
    node = _wait(d, timeout=6, text=tag)
    if node:
        _tap(d, node)
        step("picked topic %r from suggestions", tag)
    else:
        dismiss = None
        for desc in TOPIC_DISMISS_DESCS:
            dismiss = _find(d, content_desc=desc)
            if dismiss:
                break
        if dismiss:
            _tap(d, dismiss)
            step("topic suggestion %r not found, dismissed typeahead", tag)
        else:
            step("no topic suggestions for %r", tag)
            return
    time.sleep(1.0)


# --- фото в пості -----------------------------------------------------------
# Кнопка галереї в композері (new_thread_screen_gallery_button) відкриває сітку
# «Нещодавні»: перша плитка - камера, далі фото, НАЙНОВІШІ ПЕРШИМИ, з content-desc
# «Ескіз світлини, Додано 8 с тому»; вибране - «Вибрано 1 з ...». Кнопка «Готово».
# Бекенд заливає фото в галерею по одному з паузою (push_media), тож останні N
# плиток - саме наші, а тапаючи їх від N-ї до 1-ї, отримуємо порядок поста.
# Прикріплене фото в композері має кнопку «Видалити вкладення».
GALLERY_BUTTON_ID = "new_thread_screen_gallery_button"
GALLERY_ITEM_ID = "gallery_picker_grid_item_container"
GALLERY_THUMB_RE = re.compile(r"(Ескіз|Эскиз|thumbnail|Thumbnail)")
GALLERY_SELECTED_RE = re.compile(r"^(Вибрано|Выбрано|Selected)")
GALLERY_DONE_TEXTS = ["Готово", "Done", "Далі", "Next"]
ATTACHMENT_REMOVE_DESCS = ["Видалити вкладення", "Remove attachment", "Удалить вложение"]
PERMISSION_ALLOW_IDS = ["permission_allow_button", "permission_allow_all_button"]
MEDIA_PERMISSIONS = [
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_EXTERNAL_STORAGE",
]


def _gallery_thumbs(d: u2.Device) -> list[dict[str, str]]:
    root = ET.fromstring(d.dump_hierarchy())
    items = [dict(n.attrib) for n in root.iter("node")
             if _seg(n.attrib.get("resource-id", "")) == GALLERY_ITEM_ID
             and GALLERY_THUMB_RE.search(n.attrib.get("content-desc", ""))]
    items.sort(key=lambda a: tuple(map(int, re.findall(r"\d+", a["bounds"])[:2]))[::-1])
    return items


def _attach_media(d: u2.Device, count: int, timeout: float, step) -> None:
    """Прикріпити `count` найновіших фото з галереї в порядку, у якому їх залили."""
    for perm in MEDIA_PERMISSIONS:      # щоб не було системного питання про доступ
        try:
            d.shell(f"pm grant {THREADS_PKG} {perm}", timeout=10)
        except Exception:  # noqa: BLE001 - немає такого дозволу в цій версії Android
            pass
    btn = _wait(d, timeout=timeout, resource_id=GALLERY_BUTTON_ID)
    if not btn:
        raise RuntimeError(f"кнопку галереї не знайдено ({GALLERY_BUTTON_ID})")
    _tap(d, btn)
    time.sleep(2.5)
    for rid in PERMISSION_ALLOW_IDS:     # якщо Android усе ж спитав
        allow = _find(d, resource_id=rid)
        if allow:
            _tap(d, allow)
            step("media permission allowed")
            time.sleep(2.0)
            break
    end = time.time() + timeout
    thumbs = _gallery_thumbs(d)
    while len(thumbs) < count and time.time() < end:
        time.sleep(0.8)
        thumbs = _gallery_thumbs(d)
    if len(thumbs) < count:
        raise RuntimeError(f"у галереї {len(thumbs)} фото, а потрібно {count}")
    for node in reversed(thumbs[:count]):
        _tap(d, node)
        time.sleep(random.uniform(0.6, 1.2))
    picked = sum(1 for n in _gallery_thumbs(d) if GALLERY_SELECTED_RE.match(n.get("content-desc", "")))
    if picked != count:
        raise RuntimeError(f"вибрано {picked} фото з {count}")
    done = _wait(d, timeout=10, text=GALLERY_DONE_TEXTS)
    if not done:
        raise RuntimeError("кнопку «Готово» в галереї не знайдено")
    _tap(d, done)
    if not _wait(d, timeout=timeout, resource_id="new_thread_screen_composer"):
        raise RuntimeError("після вибору фото композер не повернувся")
    time.sleep(1.5)
    attached = 0
    for desc in ATTACHMENT_REMOVE_DESCS:
        root = ET.fromstring(d.dump_hierarchy())
        attached = sum(1 for n in root.iter("node") if n.attrib.get("content-desc") == desc)
        if attached:
            break
    if not attached:
        raise RuntimeError("фото не прикріпилось до поста")
    step("attached %d photo(s)", count)


def _remove_device_files(d: u2.Device, paths: list[str]) -> None:
    for p in paths:
        try:
            d.shell(f'rm -f "{p}"', timeout=10)
        except Exception:  # noqa: BLE001
            pass
    try:
        d.shell("cmd media rescan /sdcard/DCIM/Camera", timeout=20)
    except Exception:  # noqa: BLE001
        pass


def threads_post(d: u2.Device, text: str, publish: bool = True, timeout: float = 20,
                 media: Optional[list[str]] = None) -> dict[str, Any]:
    """Створити пост у Threads.

    Кроки: відкрити застосунок -> тап 'What's new?' -> [фото з галереї] ->
    ввести текст -> 'Post'.
    publish=False -> заповнити композер, але НЕ публікувати (безпечний тест).
    media - шляхи фото на пристрої, уже залитих у галерею (push_media) у порядку
    поста; після підтвердженої публікації файли видаляються з телефона.
    """
    media = [m for m in (media or []) if m]
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
    if media:
        _attach_media(d, len(media), timeout, step)
        # Після галереї фокус у полі не гарантований: ставимо його тапом.
        field = _wait(d, timeout=timeout, resource_id="new_thread_screen_composer")
        if field:
            _tap(d, field)
            time.sleep(0.8)
    d.send_keys(text, clear=True)        # у сфокусоване поле
    time.sleep(0.8)

    typed = _find(d, resource_id="new_thread_screen_composer")
    typed_text = typed.get("text") if typed else None
    step("typed %d chars, field has %s chars", len(text), len(typed_text) if typed_text else 0)

    # Тег у кінці відкриває список підказок тем, який закриває кнопку «Опублікувати».
    # Вибираємо тему зі списку: тег стає справжньою темою Threads, список зникає.
    _pick_topic(d, text, step)

    if not publish:
        step("dry run done")
        return {"status": "drafted", "text": text, "typed": typed_text, "media": len(media)}

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
    # Фото прибираємо з телефона лише після підтвердження: непідтверджений пост
    # ще вивантажується, і Threads може знадобитись файл.
    if media and confirmed:
        _remove_device_files(d, media)
    return {"status": "posted", "text": text, "confirmed": confirmed, "media": len(media)}


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


# --- поведінка: особисті повідомлення ---------------------------------------
# Вкладка «Повідомлення» (resource-id barcelona_tab_messaging) -> чіпи «Вхідні» /
# «Запити». Рядок чату - клікабельний messaging_thread_row з ig_text:
#   [username, текст останнього повідомлення (ПОВНИЙ, хоч на екрані урізаний)
#    або «2 нові повідомлення», « · 5 год», ...].
# Непрочитаний чат у «Вхідних» має додатковий порожній елемент біля правого краю
# (крапку). У «Запитах» кожен рядок - ще не прийнятий запит; відкрити його
# можна непомітно для відправника, доки запит не прийнято.
# У чаті кожне повідомлення - вузол content-desc «Текстове повідомлення із чата»
# з текстом усередині: вхідні притиснуті ліворуч, наші - праворуч. Поле вводу
# messaging_message_box, кнопка messaging_send_button (з'являється, коли є текст).
# Запит спершу треба «Прийняти» - до того поля вводу немає.
MESSAGING_TAB_ID = "barcelona_tab_messaging"
DM_ROW_ID = "messaging_thread_row"
DM_BOX_ID = "messaging_message_box"
DM_SEND_ID = "messaging_send_button"
DM_FOLDER_TEXTS = {
    "inbox": ["Вхідні", "Inbox", "Входящие"],
    "requests": ["Запити", "Requests", "Запросы"],
}
DM_ACCEPT_TEXTS = ["Прийняти", "Accept", "Принять"]
DM_TEXT_DESCS = {"Текстове повідомлення із чата", "Text message in chat", "Текстовое сообщение из чата"}
# «2 нові повідомлення» / «2 new messages» / «2 новых сообщения»: текст треба читати в чаті.
_DM_NEW_COUNT_RE = re.compile(r"^\d+\s+(нов|new)", re.I)
DM_MAX_SWIPES = {"inbox": 2, "requests": 4}


def _dm_open_messages(d: u2.Device, timeout: float, step) -> None:
    ensure_awake(d)
    d.app_stop(THREADS_PKG)
    time.sleep(1.0)
    d.app_start(THREADS_PKG, wait=True)
    time.sleep(3.0)
    for attempt in range(3):
        tab = _wait(d, timeout=timeout, resource_id=MESSAGING_TAB_ID)
        if not tab:
            crash = _app_crash(d)
            if crash:
                raise RuntimeError(f"Threads впав після запуску: {crash}")
            raise RuntimeError(f"вкладку повідомлень не знайдено ({MESSAGING_TAB_ID})")
        # Застосунок може відновити прокручену стрічку, а тоді нижня панель
        # схована (вузол є в дампі, але тап іде у стрічку). Невеликий свайп
        # униз по стрічці повертає панель.
        d.swipe_ext("down", scale=0.3)
        time.sleep(1.0)
        _tap(d, _find(d, resource_id=MESSAGING_TAB_ID) or tab)
        if _wait(d, timeout=6, text=DM_FOLDER_TEXTS["inbox"]):
            step("messages opened (attempt %d)", attempt + 1)
            time.sleep(1.5)
            return
        step("messages tab tap did not open the screen, retrying")
    raise RuntimeError("екран «Повідомлення» не відкрився")


def _dm_open_folder(d: u2.Device, folder: str, timeout: float) -> None:
    """Перейти до списку папки з головного екрана «Повідомлення». «Вхідні» вже
    відкриті; «Запити» - окремий екран (повернення - кнопкою «Назад»)."""
    if folder == "inbox":
        return
    chip = _wait(d, timeout=timeout, text=DM_FOLDER_TEXTS[folder])
    if not chip:
        raise RuntimeError(f"чіп «{DM_FOLDER_TEXTS[folder][0]}» не знайдено")
    _tap(d, chip)
    time.sleep(2.5)


def _dm_back_to_messages(d: u2.Device, folder: str) -> None:
    if folder != "inbox":
        d.press("back")
        time.sleep(1.5)


def _dm_ensure_main(d: u2.Device, timeout: float, step) -> None:
    """Повернутись на головний екран «Повідомлення» (там є чіп «Вхідні»): кілька
    «Назад», а якщо не вийшло - перезапуск застосунку."""
    for _ in range(3):
        if _find(d, text=DM_FOLDER_TEXTS["inbox"]):
            return
        d.press("back")
        time.sleep(1.5)
    _dm_open_messages(d, timeout, step)


def _dm_rows(xml: str, folder: str) -> list[dict[str, Any]]:
    """Видимі рядки чатів: username, превʼю, непрочитаність, центр для тапу."""
    root = ET.fromstring(xml)
    out = []
    rows = [n for n in root.iter("node") if _seg(n.attrib.get("resource-id", "")) == DM_ROW_ID]
    # Рядок, обрізаний краєм екрана, нижчий за повний: його username може бути
    # схований, і першим текстом стає превʼю. Такі пропускаємо - доберемо після свайпу.
    full = max((_bounds(r)[3] - _bounds(r)[1] for r in rows), default=0)
    for row in rows:
        rx1, ry1, rx2, ry2 = _bounds(row)
        if ry2 - ry1 < full * 0.85:
            continue
        kids = [n for n in row.iter("node") if n is not row]
        texts = sorted(
            (n for n in kids if n.attrib.get("text")),
            key=lambda n: (_bounds(n)[1], _bounds(n)[0]),
        )
        if len(texts) < 2:
            continue  # рядок обрізаний краєм екрана
        username = texts[0].attrib["text"].strip()
        preview = texts[1].attrib["text"]
        if preview.startswith(" · "):
            preview = ""
        # Крапка непрочитаного: порожній вузол біля правого краю рядка.
        unread = any(
            not n.attrib.get("text") and not n.attrib.get("content-desc")
            and _bounds(n)[0] >= rx2 - 160 and (_bounds(n)[2] - _bounds(n)[0]) < 160
            for n in kids
        )
        out.append({
            "folder": folder, "username": username, "preview": preview.strip(),
            "unread": unread, "center": ((rx1 + rx2) // 2, (ry1 + ry2) // 2),
        })
    return out


def _dm_collect_rows(d: u2.Device, folder: str) -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for i in range(DM_MAX_SWIPES[folder] + 1):
        new = 0
        for r in _dm_rows(d.dump_hierarchy(), folder):
            if r["username"] not in found:
                new += 1
            found[r["username"]] = r
        if i and not new:
            break
        if i < DM_MAX_SWIPES[folder]:
            d.swipe_ext("up", scale=0.6)
            time.sleep(1.2)
    return list(found.values())


def _dm_scroll_top(d: u2.Device) -> None:
    for _ in range(3):
        d.swipe_ext("down", scale=0.7)
        time.sleep(0.6)


def _dm_find_row(d: u2.Device, folder: str, username: str) -> Optional[dict[str, Any]]:
    _dm_scroll_top(d)
    # Короткі свайпи з перекриттям, щоб рядок не проскочив між екранами.
    for i in range(DM_MAX_SWIPES[folder] * 2 + 3):
        for r in _dm_rows(d.dump_hierarchy(), folder):
            if r["username"].lower() == username.lower():
                return r
        d.swipe_ext("up", scale=0.35)
        time.sleep(1.0)
    return None


def _dm_messages(xml: str) -> dict[str, Any]:
    """Повідомлення відкритого чату: title (ім'я в шапці) і вхідні тексти
    після нашого останнього повідомлення (лише видима частина, знизу)."""
    root = ET.fromstring(xml)
    nodes = [n for n in root.iter("node") if n.attrib.get("bounds")]
    width = max((_bounds(n)[2] for n in nodes), default=1080)
    texts = [n for n in nodes if n.attrib.get("text")]
    bubbles = []
    for n in nodes:
        if n.attrib.get("content-desc") not in DM_TEXT_DESCS:
            continue
        x1, y1, x2, y2 = _bounds(n)
        # Текст - окремий вузол у межах бульбашки (у дампі Litho не завжди нащадок).
        inner = [t.attrib["text"] for t in texts
                 if t is not n and x1 <= _bounds(t)[0] and _bounds(t)[2] <= x2
                 and y1 <= _bounds(t)[1] and _bounds(t)[3] <= y2]
        if not inner:
            continue
        outgoing = x2 >= width - 60 and x1 > width * 0.15
        bubbles.append((y1, outgoing, "\n".join(inner)))
    bubbles.sort()
    incoming: list[str] = []
    for _, outgoing, text in bubbles:
        if outgoing:
            incoming = []
        else:
            incoming.append(text)
    title = ""
    header = [n for n in root.iter("node") if _seg(n.attrib.get("resource-id", "")) == "BdsPeopleCell"]
    if header:
        names = [c.attrib["text"] for c in header[0].iter("node") if c.attrib.get("text")]
        # Ім'я декоративним шрифтом дамп віддає як «........ ..» - таке відкидаємо.
        if len(names) > 1 and re.search(r"[^\W\d_]", names[1]):
            title = names[1].strip()
    return {"title": title, "incoming": incoming}


def threads_dm_scan(d: u2.Device, folders: Optional[list[str]] = None, known: Optional[list[str]] = None,
                    max_open: int = 8, timeout: float = 20) -> dict[str, Any]:
    """Непрочитані особисті: у «Вхідних» - чати з крапкою, у «Запитах» - усі.

    Нічого не надсилає. Чат відкривається лише тоді, коли замість тексту в списку
    «N нові повідомлення» (у «Запитах» це непомітно для відправника, у «Вхідних»
    чат стає прочитаним). known - підписи 'folder|username|preview' рядків, які
    бекенд уже обробив: їх не відкриваємо повторно.
    Повертає {"chats": [{folder, username, title, preview, messages, text}]}.
    """
    t0 = time.monotonic()

    def step(msg: str, *args: Any) -> None:
        log.info("[%s +%.1fs] dm-scan " + msg, d.serial, time.monotonic() - t0, *args)

    folders = [f for f in (folders or ["inbox", "requests"]) if f in DM_FOLDER_TEXTS]
    known_set = set(known or [])
    _dm_open_messages(d, timeout, step)
    chats: list[dict[str, Any]] = []
    opened = 0
    for folder in folders:
        _dm_open_folder(d, folder, timeout)
        rows = [r for r in _dm_collect_rows(d, folder) if folder == "requests" or r["unread"]]
        step("%s: %d candidate chats", folder, len(rows))
        for r in rows:
            sig = f"{folder}|{r['username']}|{r['preview']}"
            chat = {"folder": folder, "username": r["username"], "title": "", "preview": r["preview"],
                    "signature": sig, "messages": [], "text": ""}
            if r["preview"] and not _DM_NEW_COUNT_RE.match(r["preview"]):
                chat["messages"] = [r["preview"]]
            elif sig in known_set or opened >= max_open:
                continue
            else:
                row = _dm_find_row(d, folder, r["username"])
                if not row:
                    step("row %s not found again", r["username"])
                    continue
                d.click(*row["center"])
                time.sleep(3.0)
                msgs = _dm_messages(d.dump_hierarchy())
                opened += 1
                chat["title"] = msgs["title"]
                chat["messages"] = msgs["incoming"]
                d.press("back")
                time.sleep(1.5)
            chat["text"] = re.sub(r"\n\s*\n+", "\n", "\n".join(chat["messages"])).strip()
            if chat["text"]:
                chats.append(chat)
        _dm_back_to_messages(d, folder)
    step("collected %d chats (opened %d)", len(chats), opened)
    return {"chats": chats}


def _dm_send_one(d: u2.Device, item: dict[str, Any], timeout: float, step) -> None:
    folder = item.get("folder") if item.get("folder") in DM_FOLDER_TEXTS else "inbox"
    username = str(item["username"])
    texts = [t for t in (item.get("texts") or []) if str(t).strip()]
    if not texts:
        raise RuntimeError("немає тексту відповіді")
    _dm_open_folder(d, folder, timeout)
    try:
        row = _dm_find_row(d, folder, username)
        if not row:
            raise RuntimeError(f"чат {username} не знайдено в «{DM_FOLDER_TEXTS[folder][0]}»")
        d.click(*row["center"])
        time.sleep(random.uniform(2.5, 5.0))   # людина спершу читає
        if folder == "requests":
            accept = _wait(d, timeout=timeout, text=DM_ACCEPT_TEXTS)
            if not accept:
                raise RuntimeError("кнопку «Прийняти» не знайдено")
            _tap(d, accept)
            step("accepted request from %s", username)
            time.sleep(2.0)
        for text in texts:
            box = _wait(d, timeout=timeout, resource_id=DM_BOX_ID)
            if not box:
                raise RuntimeError(f"поле вводу не знайдено ({DM_BOX_ID})")
            _tap(d, box)
            time.sleep(0.8)
            d.send_keys(text, clear=True)
            # Скільки людина друкувала б цей текст (але не довше 15 с).
            time.sleep(min(15.0, 1.5 + len(text) / random.uniform(9, 14)))
            send = _wait(d, timeout=10, resource_id=DM_SEND_ID)
            if not send:
                raise RuntimeError(f"кнопку «Надіслати» не знайдено ({DM_SEND_ID})")
            _tap(d, send)
            time.sleep(2.0)
            left = _find(d, resource_id=DM_BOX_ID)
            if left and left.get("text") and left.get("text") == text:
                raise RuntimeError("повідомлення лишилось у полі вводу - не надіслано")
            step("sent %d chars to %s", len(text), username)
            time.sleep(random.uniform(1.5, 3.5))
    finally:
        # Прийнятий запит переїжджає у «Вхідні», тож «Назад» веде куди завгодно:
        # повертаємось на головний екран «Повідомлення» напряму.
        _dm_ensure_main(d, timeout, step)


def threads_dm_send(d: u2.Device, items: list[dict[str, Any]], timeout: float = 20) -> dict[str, Any]:
    """Надіслати відповіді: items = [{username, folder, texts: [..]}].
    Запит («Запити») спершу приймається. Повертає {"results": [{username, ok, error?}]}
    у тому ж порядку; помилка одного чату не зупиняє решту."""
    t0 = time.monotonic()

    def step(msg: str, *args: Any) -> None:
        log.info("[%s +%.1fs] dm-send " + msg, d.serial, time.monotonic() - t0, *args)

    _dm_open_messages(d, timeout, step)
    results = []
    for item in items or []:
        try:
            _dm_send_one(d, item, timeout, step)
            results.append({"username": item.get("username"), "ok": True})
        except Exception as exc:  # noqa: BLE001
            step("failed for %s: %s", item.get("username"), exc)
            results.append({"username": item.get("username"), "ok": False, "error": str(exc)})
            if not _find(d, text=DM_FOLDER_TEXTS["inbox"]):
                step("cannot get back to messages, stopping")
                break
        time.sleep(random.uniform(3.0, 8.0))
    while len(results) < len(items or []):
        results.append({"username": items[len(results)].get("username"), "ok": False,
                        "error": "сеанс перервано"})
    return {"results": results}


# --- поведінка: коментарі під нашими постами --------------------------------
# Вкладка «Дії» (barcelona_tab_activity_feed) -> чіп «Розмови»: лише відповіді
# іншим людям на наші пости й наші відповіді. Рядок activity_feed_screen_row:
#   аватар (content-desc «<author> Основна світлина»), заголовок «<author> 2 год»,
#   ig_text #1 - на що відповіли (наш пост / наша відповідь), ig_text #2.. - коментар,
#   кнопка feed_post_ufi_reply_button («Відповісти» або «Відповісти 1», якщо під
#   коментарем уже є відповіді). Рядки без кнопки - лайки/підписки, пропускаємо.
# «Відповісти» відкриває той самий композер, що й новий пост.
ACTIVITY_TAB_ID = "barcelona_tab_activity_feed"
ACTIVITY_ROW_ID = "activity_feed_screen_row"
REPLY_BUTTON_ID = "feed_post_ufi_reply_button"
CONVERSATIONS_TEXTS = ["Розмови", "Conversations", "Разговоры"]
ACTIVITY_TITLE_TEXTS = ["Активність", "Activity", "Активность"]
_AVATAR_RE = re.compile(r"^(.+?)\s+(Основна світлина|profile picture|Основное фото)", re.I)
_AGE_RE = re.compile(r"(\d+)\s*(с|сек|s|хв|m|мин|год|h|ч|д|d|дн|тиж|w|нед)\.?\s*$", re.I)
_AGE_MIN = {"с": 0, "сек": 0, "s": 0, "хв": 1, "m": 1, "мин": 1, "год": 60, "h": 60, "ч": 60,
            "д": 1440, "d": 1440, "дн": 1440, "тиж": 10080, "w": 10080, "нед": 10080}
COMMENTS_MAX_SWIPES = 4
# Службовий підпис замість тексту (коментар з фото/відео без тексту).
COMMENT_LABELS = {"Відповідає вам", "Replied to you", "Отвечает вам"}


def parse_age_minutes(s: str) -> Optional[int]:
    """'27 хв' -> 27, '2 год' -> 120, '1 д.' -> 1440; невідоме -> None."""
    m = _AGE_RE.search((s or "").replace("\xa0", " ").strip())
    if not m:
        return None
    return int(m.group(1)) * _AGE_MIN[m.group(2).lower()]


def _inside(n: ET.Element, box: tuple[int, int, int, int], slack: int = 12) -> bool:
    # Кнопки під коментарем буває на кілька пікселів виходять за межі рядка.
    x1, y1, x2, y2 = _bounds(n)
    return (box[0] - slack <= x1 and x2 <= box[2] + slack
            and box[1] - slack <= y1 and y2 <= box[3] + slack)


def _comment_rows(xml: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml)
    nodes = [n for n in root.iter("node") if n.attrib.get("bounds")]
    rows = [n for n in nodes if _seg(n.attrib.get("resource-id", "")) == ACTIVITY_ROW_ID]
    full = max((_bounds(r)[3] - _bounds(r)[1] for r in rows), default=0)
    out = []
    for row in rows:
        box = _bounds(row)
        inside = [n for n in nodes if n is not row and _inside(n, box)]
        reply_btn = next((n for n in inside if _seg(n.attrib.get("resource-id", "")) == REPLY_BUTTON_ID), None)
        if reply_btn is None:
            continue  # лайк, підписка - не коментар (або рядок обрізаний знизу)
        author = ""
        for n in inside:
            m = _AVATAR_RE.match(n.attrib.get("content-desc", ""))
            if m:
                author = m.group(1).strip()
                break
        texts = sorted((n for n in inside if _seg(n.attrib.get("resource-id", "")) == "ig_text"
                        and n.attrib.get("text") and n.attrib["text"].strip() not in COMMENT_LABELS),
                       key=lambda n: (_bounds(n)[1], _bounds(n)[0]))
        if not author or len(texts) < 2:
            continue
        header = next((n.attrib.get("text", "") for n in inside
                       if n.attrib.get("text", "").startswith(author + " ")), "")
        count = re.search(r"(\d+)\s*$", reply_btn.attrib.get("content-desc", ""))
        out.append({
            "author": author,
            "context": texts[0].attrib["text"].strip(),
            "text": "\n".join(t.attrib["text"].strip() for t in texts[1:]).strip(),
            "age_minutes": parse_age_minutes(header[len(author):]),
            "reply_count": int(count.group(1)) if count else 0,
            "reply_center": _center(reply_btn.attrib["bounds"]),
            "full": (box[3] - box[1]) >= full * 0.6,
        })
    return out


def _open_conversations(d: u2.Device, timeout: float, step) -> None:
    ensure_awake(d)
    d.app_stop(THREADS_PKG)
    time.sleep(1.0)
    d.app_start(THREADS_PKG, wait=True)
    time.sleep(3.0)
    for attempt in range(3):
        tab = _wait(d, timeout=timeout, resource_id=ACTIVITY_TAB_ID)
        if not tab:
            crash = _app_crash(d)
            if crash:
                raise RuntimeError(f"Threads впав після запуску: {crash}")
            raise RuntimeError(f"вкладку «Дії» не знайдено ({ACTIVITY_TAB_ID})")
        d.swipe_ext("down", scale=0.3)   # повернути сховану нижню панель
        time.sleep(1.0)
        _tap(d, _find(d, resource_id=ACTIVITY_TAB_ID) or tab)
        if _wait(d, timeout=6, text=ACTIVITY_TITLE_TEXTS):
            break
        step("activity tab tap did not open the screen, retrying")
    else:
        raise RuntimeError("екран «Активність» не відкрився")
    chip = _wait(d, timeout=timeout, text=CONVERSATIONS_TEXTS)
    if not chip:
        raise RuntimeError("фільтр «Розмови» не знайдено")
    _tap(d, chip)
    time.sleep(2.5)
    step("conversations opened")


def threads_comments_scan(d: u2.Device, max_rows: int = 30, timeout: float = 20) -> dict[str, Any]:
    """Коментарі інших людей під нашими постами з «Дії → Розмови». Нічого не
    відкриває й не публікує. Повертає {"comments": [{author, text, context,
    age_minutes, reply_count}]} - найновіші першими."""
    t0 = time.monotonic()

    def step(msg: str, *args: Any) -> None:
        log.info("[%s +%.1fs] comments-scan " + msg, d.serial, time.monotonic() - t0, *args)

    _open_conversations(d, timeout, step)
    found: dict[tuple[str, str, str], dict[str, Any]] = {}
    for i in range(COMMENTS_MAX_SWIPES + 1):
        new = 0
        for r in _comment_rows(d.dump_hierarchy()):
            key = (r["author"], r["context"], r["text"])
            if key not in found:
                new += 1
                found[key] = {k: r[k] for k in ("author", "text", "context", "age_minutes", "reply_count")}
        if len(found) >= max_rows or (i and not new):
            break
        if i < COMMENTS_MAX_SWIPES:
            d.swipe_ext("up", scale=0.5)
            time.sleep(1.2)
    comments = list(found.values())[:max_rows]
    step("collected %d comments", len(comments))
    return {"comments": comments}


def _find_comment_row(d: u2.Device, item: dict[str, Any]) -> Optional[dict[str, Any]]:
    for _ in range(3):
        d.swipe_ext("down", scale=0.7)
        time.sleep(0.6)
    for _ in range(COMMENTS_MAX_SWIPES * 2 + 3):
        for r in _comment_rows(d.dump_hierarchy()):
            if (r["author"].lower() == str(item["author"]).lower() and r["text"] == item["text"]
                    and (not item.get("context") or r["context"] == item["context"])):
                return r
        d.swipe_ext("up", scale=0.35)
        time.sleep(1.0)
    return None


def threads_comments_reply(d: u2.Device, items: list[dict[str, Any]], timeout: float = 20) -> dict[str, Any]:
    """Відповісти на коментарі: items = [{author, text, context, reply}].
    Повертає {"results": [{author, ok, confirmed?, error?}]} у тому ж порядку."""
    t0 = time.monotonic()

    def step(msg: str, *args: Any) -> None:
        log.info("[%s +%.1fs] comments-reply " + msg, d.serial, time.monotonic() - t0, *args)

    _open_conversations(d, timeout, step)
    results: list[dict[str, Any]] = []
    for item in items or []:
        author = item.get("author")
        try:
            if not _find(d, text=ACTIVITY_TITLE_TEXTS):
                _open_conversations(d, timeout, step)
            row = _find_comment_row(d, item)
            if not row:
                raise RuntimeError(f"коментар {author} не знайдено в «Розмовах»")
            d.click(*row["reply_center"])
            field = _wait(d, timeout=timeout, resource_id="new_thread_screen_composer")
            if not field:
                raise RuntimeError("вікно відповіді не відкрилось (new_thread_screen_composer)")
            time.sleep(random.uniform(1.5, 3.0))
            _tap(d, field)
            time.sleep(0.6)
            reply = str(item.get("reply") or "").strip()
            if not reply:
                raise RuntimeError("порожня відповідь")
            d.send_keys(reply, clear=True)
            time.sleep(min(15.0, 1.5 + len(reply) / random.uniform(9, 14)))
            _pick_topic(d, reply, step)
            post = _wait(d, timeout=timeout, resource_id="new_thread_screen_post_button")
            if not post:
                raise RuntimeError("кнопку «Опублікувати» не знайдено")
            _tap(d, post)
            confirmed = _wait(d, timeout=PUBLISH_CONFIRM_TIMEOUT, text=POSTED_TEXTS) is not None
            step("replied to %s, confirmed=%s", author, confirmed)
            results.append({"author": author, "ok": True, "confirmed": confirmed})
            time.sleep(random.uniform(3.0, 8.0))
        except Exception as exc:  # noqa: BLE001
            step("failed for %s: %s", author, exc)
            results.append({"author": author, "ok": False, "error": str(exc)})
            # Не лишати відкритий композер із текстом: «Скасувати» і, якщо
            # спитає, відкинути чернетку; потім - знову «Розмови».
            try:
                _open_conversations(d, timeout, step)
            except Exception as exc2:  # noqa: BLE001
                step("cannot reopen conversations: %s", exc2)
                break
    while len(results) < len(items or []):
        results.append({"author": items[len(results)].get("author"), "ok": False, "error": "сеанс перервано"})
    return {"results": results}


# --- реєстр поведінок -------------------------------------------------------
REGISTRY = {
    "threads_post": threads_post,
    "threads_metrics": threads_metrics,
    "threads_dm_scan": threads_dm_scan,
    "threads_dm_send": threads_dm_send,
    "threads_comments_scan": threads_comments_scan,
    "threads_comments_reply": threads_comments_reply,
}


if __name__ == "__main__":
    import sys
    text = sys.argv[1] if len(sys.argv) > 1 else "Hello from automation"
    publish = "--dry" not in sys.argv
    dev = u2.connect("emulator-5554")
    print(threads_post(dev, text, publish=publish))
