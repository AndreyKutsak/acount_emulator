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

import re
import time
import xml.etree.ElementTree as ET
from typing import Any, Optional

import uiautomator2 as u2

THREADS_PKG = "com.instagram.barcelona"

# Текстові підписи залежать від мови інтерфейсу (на відміну від resource-id).
# Додайте сюди переклад, якщо автопостинг знову не знаходить елемент після
# зміни локалі емулятора.
COMPOSER_ENTRY_TEXTS = ["What’s new?", "What's new?", "Що нового?"]
POST_BUTTON_TEXTS = ["Post", "Опублікувати", "Поділитися"]


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


# --- поведінка: пост у Threads ----------------------------------------------
def threads_post(d: u2.Device, text: str, publish: bool = True, timeout: float = 20) -> dict[str, Any]:
    """Створити пост у Threads.

    Кроки: відкрити застосунок -> тап 'What's new?' -> ввести текст -> 'Post'.
    publish=False -> заповнити композер, але НЕ публікувати (безпечний тест).
    """
    # чистий старт: перезапускаємо застосунок, щоб гарантовано опинитись у стрічці
    # (інакше 'What's new?' може вказувати на вже відкритий/закритий композер).
    d.app_stop(THREADS_PKG)
    time.sleep(1.0)
    d.app_start(THREADS_PKG, wait=True)
    time.sleep(3.0)

    # 1) відкрити композер
    entry = _wait(d, timeout=timeout, text=COMPOSER_ENTRY_TEXTS)
    if not entry:
        raise RuntimeError(
            f"вхід у композер не знайдено (жоден з варіантів: {COMPOSER_ENTRY_TEXTS})"
        )
    _tap(d, entry)

    # 2) дочекатись поля композера (воно само отримує фокус) і ввести текст
    field = _wait(d, timeout=timeout, resource_id="new_thread_screen_composer")
    if not field:
        raise RuntimeError("композер не відкрився (new_thread_screen_composer)")
    time.sleep(1.0)                      # дати клавіатурі піднятись
    d.send_keys(text, clear=True)        # у сфокусоване поле
    time.sleep(0.8)

    typed = _find(d, resource_id="new_thread_screen_composer")
    typed_text = typed.get("text") if typed else None

    if not publish:
        return {"status": "drafted", "text": text, "typed": typed_text}

    # 3) натиснути 'Post' (клік по координатах)
    post = _wait(d, timeout=timeout, resource_id="new_thread_screen_post_button")
    if not post:
        post = _wait(d, timeout=5, text=POST_BUTTON_TEXTS)
        if not post:
            raise RuntimeError(f"кнопку 'Post' не знайдено (variants: {POST_BUTTON_TEXTS})")
    _tap(d, post)
    time.sleep(2.5)
    return {"status": "posted", "text": text}


# --- реєстр поведінок -------------------------------------------------------
REGISTRY = {"threads_post": threads_post}


if __name__ == "__main__":
    import sys
    text = sys.argv[1] if len(sys.argv) > 1 else "Hello from automation"
    publish = "--dry" not in sys.argv
    dev = u2.connect("emulator-5554")
    print(threads_post(dev, text, publish=publish))
