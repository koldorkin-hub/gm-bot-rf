"""Сборка запроса к модели: системник, блок профиля с календарём, штамп у сообщения.

Повторяет то, что в боевом боте делает узел Build Profile Context: календарь и «сейчас»
считает КОД, агент их только читает (knowledge/memory/date-handling.md). Ошибка здесь
испортила бы все сценарии с датами, поэтому весь календарь собирается из ОДНОЙ календарной
даты клиента, как в боевом узле, а не из нескольких вызовов «сейчас».
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

DAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
DAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]


def load_profile(name: str) -> dict:
    return json.loads((ROOT / "profiles" / f"{name}.json").read_text(encoding="utf-8"))


def _age_words(years: int) -> str:
    r100, r10 = years % 100, years % 10
    if 11 <= r100 <= 14 or r10 == 0 or r10 >= 5:
        return f"{years} лет"
    return f"{years} год" if r10 == 1 else f"{years} года"


def calendar_block(today: dt.date, clock: str, profile: dict) -> str:
    """Календарь — ровно те строки, на которые ссылается блок ДАТА И ДЕНЬ НЕДЕЛИ."""
    yday, tmrw = today - dt.timedelta(days=1), today + dt.timedelta(days=1)
    monday = today - dt.timedelta(days=today.weekday())
    grid = " ".join(
        f"[{DAYS_SHORT[i]} {(monday + dt.timedelta(days=i)).strftime('%d.%m')}]"
        if (monday + dt.timedelta(days=i)) == today
        else f"{DAYS_SHORT[i]} {(monday + dt.timedelta(days=i)).strftime('%d.%m')}"
        for i in range(7)
    )
    lines = [
        f"СЕЙЧАС У КЛИЕНТА: {DAYS[today.weekday()]}, {today.strftime('%d.%m.%Y')}, {clock} "
        f"({profile.get('timezone', 'Europe/Moscow')})",
        f"НЕДЕЛЯ: {grid}  (в скобках — сегодня)",
        f"ВЧЕРА: {DAYS_SHORT[yday.weekday()]} {yday.strftime('%d.%m.%Y')} | "
        f"ЗАВТРА: {DAYS_SHORT[tmrw.weekday()]} {tmrw.strftime('%d.%m.%Y')}",
        f"ДЕНЬ НЕДЕЛИ: {today.weekday() + 1} (Пн=1)",
    ]
    start = profile.get("plan_started_on")
    if start:
        n = (today - dt.date.fromisoformat(start)).days
        lines.append(f"ПРОГРАММА: сегодня ДЕНЬ {n + 1}, НЕДЕЛЯ {n // 7 + 1} (старт {start})")
    return "\n".join(lines)


def profile_block(profile: dict, today: dt.date, clock: str) -> str:
    """Блок ПРОФИЛЬ КЛИЕНТА — то, что Load Profile инжектит в системник."""
    out = ["=== ПРОФИЛЬ КЛИЕНТА ===", calendar_block(today, clock, profile), ""]
    if profile.get("client_summary"):
        out += ["ВЫЖИМКА ПО КЛИЕНТУ: " + profile["client_summary"], ""]

    fields = []
    if profile.get("display_name"):
        fields.append(f"имя: {profile['display_name']}")
    if profile.get("birth_date"):
        born = dt.date.fromisoformat(profile["birth_date"])
        years = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        fields.append(f"возраст: {_age_words(years)} ({profile['birth_date']})")
    for key, label in (("sex", "пол"), ("height_cm", "рост, см"), ("current_weight_kg", "вес, кг"),
                       ("main_goal", "цель"), ("experience_level", "опыт"),
                       ("days_per_week", "тренировок в неделю"), ("diet_type", "питание"),
                       ("target_kcal", "цель по калориям")):
        if profile.get(key) not in (None, ""):
            fields.append(f"{label}: {profile[key]}")
    if profile.get("disciplines"):
        fields.append("дисциплины: " + ", ".join(d["discipline"] for d in profile["disciplines"]))
    out += ["ОСНОВНОЕ: " + "; ".join(fields), ""]

    # Здоровье. В контекст идёт то же, что в боевом: у condition только name, у medication —
    # только активные (knowledge/memory/memory-data-schema.md, грабля инжекта контекста).
    allergens = profile.get("allergens") or []
    if allergens:
        out.append("АЛЛЕРГИИ И НЕПЕРЕНОСИМОСТИ: " + "; ".join(
            f"{a['substance']} ({'аллергия' if a['severity'] == 'allergy' else 'непереносимость'})"
            for a in allergens))
    if profile.get("conditions"):
        out.append("СОСТОЯНИЯ: " + "; ".join(c["name"] for c in profile["conditions"]))
    injuries = [i for i in (profile.get("injuries") or []) if i.get("status") != "resolved"]
    if injuries:
        out.append("ТРАВМЫ: " + "; ".join(f"{i['area']} [{i['status']}, id={i['id']}]" for i in injuries))
    meds = [m for m in (profile.get("medications") or []) if m.get("active", True)]
    if meds:
        out.append("ПРИНИМАЕТ: " + "; ".join(m["name"] for m in meds))
    if profile.get("exclusions"):
        out.append("АКТИВНЫЕ ОГРАНИЧЕНИЯ: " + "; ".join(
            f"{e['scope']}={e['value']}" for e in profile["exclusions"]))
    if profile.get("custom_instructions"):
        out += ["", "ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ КЛИЕНТА: " + profile["custom_instructions"]]
    for key, label in (("active_plan", "ПЛАН"), ("plan_month", "ПЛАН НА МЕСЯЦ"),
                       ("plan_week", "ПЛАН НА НЕДЕЛЮ")):
        if profile.get(key):
            out.append(f"{label}: {profile[key]}")
    consent = profile.get("health_consent_at")
    out += ["", "СОГЛАСИЕ НА ДАННЫЕ О ЗДОРОВЬЕ: "
            + (f"получено {consent}, карту здоровья вести можно" if consent
               else "НЕ получено — записывать аллергии, состояния, травмы и препараты нельзя")]
    ledger = profile.get("today_ledger")
    out += ["", "СЕГОДНЯ УЖЕ В ЖУРНАЛЕ: " + (ledger if ledger else "записей нет")]
    return "\n".join(out)


def stamp(today: dt.date, clock: str) -> str:
    """Короткая метка перед сообщением клиента (~60 знаков) — она оседает в истории навсегда."""
    yday, tmrw = today - dt.timedelta(days=1), today + dt.timedelta(days=1)
    return (f"[СЕГОДНЯ {DAYS_SHORT[today.weekday()]} {today.strftime('%d.%m.%Y')} {clock}, "
            f"вчера {DAYS_SHORT[yday.weekday()]} {yday.strftime('%d.%m')}, "
            f"завтра {DAYS_SHORT[tmrw.weekday()]} {tmrw.strftime('%d.%m')}]")


def system_message(profile: dict, today: dt.date, clock: str) -> str:
    bot_type = profile.get("bot_type", "client")
    tpl = (ROOT / "prompt" / f"system_message.{bot_type}.txt").read_text(encoding="utf-8")
    persona = (ROOT / "prompt" / profile["persona_file"]).read_text(encoding="utf-8").strip()
    text = tpl.replace("{{PERSONA}}", persona).replace(
        "{{PROFILE}}", profile_block(profile, today, clock))
    if "{{" in text:
        raise AssertionError("в системнике остались неподставленные маркеры")
    return text


def parse_moment(value: str) -> tuple[dt.date, str]:
    """'2026-09-10 08:15' -> (дата, '08:15'). Момент задаёт сценарий, а не часы машины."""
    day, clock = value.split(" ")
    return dt.date.fromisoformat(day), clock
