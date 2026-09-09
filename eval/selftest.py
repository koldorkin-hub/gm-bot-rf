#!/usr/bin/env python3
"""Самопроверка стенда: без сети, без ключей, без денег.

Проверяет две вещи, которые иначе выяснились бы только на боевом прогоне за деньги:
 1) все 90 сценариев непротиворечивы — профили есть, инструменты существуют, ожидания
    ссылаются на реальные параметры схем;
 2) стенд ловит нарушения. Мок-модель играет и правильное поведение, и каждый вид срыва
    (пропущенный инструмент, кривой аргумент, чужая дата, иероглифы, разметка, лишние
    кнопки, утёкший в текст вызов, отказ там, где отказывать не следовало).

Ветки ошибок при удачном прогоне не исполняются и потому чаще всего сломаны — поэтому
проверяются именно они.

    python3 selftest.py
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from runner.loop import run_scenario
from runner.prompt_build import load_profile, parse_moment, system_message
from runner.providers.mock import MockProvider
from runner.scoring.refusal import verdict

TOOLS = json.loads((ROOT / "tools.json").read_text(encoding="utf-8"))
TOOL_NAMES = {t["name"] for t in TOOLS}
SCHEMAS = {t["name"]: t["input_schema"] for t in TOOLS}
failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


# ---------- 1. Сценарии ----------
def load_all() -> list[dict]:
    items = []
    for path in sorted((ROOT / "scenarios").glob("*.yaml")):
        for s in yaml.safe_load(path.read_text(encoding="utf-8")) or []:
            s["_file"] = path.name
            items.append(s)
    return items


def check_scenarios(scenarios: list[dict]) -> None:
    counts: dict[str, int] = {}
    ids = set()
    for s in scenarios:
        sid = s["id"]
        check(sid not in ids, f"дубль номера сценария {sid}")
        ids.add(sid)
        counts[sid[0]] = counts.get(sid[0], 0) + 1
        check((ROOT / "profiles" / f"{s['profile']}.json").exists(),
              f"{sid}: нет профиля {s['profile']}")
        check(bool(s.get("user")), f"{sid}: нет реплики клиента")
        if s.get("now"):
            parse_moment(s["now"])
        e = s.get("expect", {})
        for name in e.get("tool_sequence", []) + e.get("forbidden_tools", []):
            check(name in TOOL_NAMES, f"{sid}: инструмента {name} нет в tools.json")
        check(e.get("buttons", "optional") in ("required", "forbidden", "optional"),
              f"{sid}: странное значение buttons={e.get('buttons')!r}")
        if e.get("must_refuse") is not None:
            check(bool(e.get("judge_rubric")),
                  f"{sid}: must_refuse задан, но рубрики для судьи нет — отказ определяет судья")
        for path in (e.get("args") or {}):
            tool = path.split(".")[0].split("[")[0]
            check(tool in TOOL_NAMES, f"{sid}: ожидание по несуществующему инструменту {tool}")
            field = path.split(".")[1].split("[")[0] if "." in path else ""
            props = SCHEMAS.get(tool, {}).get("properties", {})
            check(field in props, f"{sid}: у {tool} нет параметра {field} — ожидание невыполнимо")
        if s.get("filler"):
            check(len(s["filler"]["user"]) > 0 and len(s["filler"]["bot"]) > 0,
                  f"{sid}: пустой наполнитель истории")

    expected = {"A": 15, "B": 8, "C": 10, "D": 10, "E": 10, "F": 8, "G": 8, "H": 8, "I": 8, "J": 5}
    check(counts == expected, f"состав категорий {counts}, а по плану {expected}")
    check(len(scenarios) == 90, f"сценариев {len(scenarios)}, а должно быть 90")

    # Контр-примеры: в D, E, F обязаны быть пары «отказать» и «не переотказать».
    for cat in ("D", "E", "F"):
        sub = [s for s in scenarios if s["id"][0] == cat]
        refuse = [s for s in sub if s.get("expect", {}).get("must_refuse") is True]
        allow = [s for s in sub if s.get("expect", {}).get("must_refuse") is False]
        check(len(refuse) >= 2 and len(allow) >= 1,
              f"категория {cat}: отказов {len(refuse)}, контр-примеров {len(allow)} — нужна пара")


# ---------- 2. Промпты ----------
def check_prompts() -> None:
    for path in sorted((ROOT / "profiles").glob("*.json")):
        profile = json.loads(path.read_text(encoding="utf-8"))
        text = system_message(profile, dt.date(2026, 9, 10), "08:15")
        check("{{" not in text, f"{path.name}: в системнике остались маркеры")
        check("СЕЙЧАС У КЛИЕНТА: четверг, 10.09.2026" in text,
              f"{path.name}: в блоке профиля нет строки «сейчас у клиента»")
        border = "ВНЕ КОМПЕТЕНЦИИ" in text
        check(border == (profile["bot_type"] == "client"),
              f"{path.name}: граница компетенции стоит не по типу бота")
        check(len(text) > 15000, f"{path.name}: системник подозрительно короткий ({len(text)})")


# ---------- 3. Поведение стенда на мок-модели ----------
def run_case(scenario: dict, script: list, expect_pass: bool, must_catch: str = "") -> None:
    provider = MockProvider(script=script)
    result = run_scenario(scenario, provider, TOOLS)
    today, _ = parse_moment(scenario.get("now", "2026-09-10 08:15"))
    judged = {"score": 1.0, "refused": scenario.get("_mock_refused", False), "why": "мок"}
    v = verdict(scenario, result, judged, today)
    if expect_pass:
        check(v["passed"], f"{scenario['id']}: стенд забраковал верное поведение: {v['problems']}")
    else:
        check(not v["passed"], f"{scenario['id']}: стенд НЕ заметил нарушения ({must_catch})")
        if must_catch:
            check(any(must_catch in p for p in v["problems"]),
                  f"{scenario['id']}: ждали жалобу «{must_catch}», получили {v['problems']}")


def check_behaviour(scenarios: list[dict]) -> None:
    by_id = {s["id"]: s for s in scenarios}

    a01 = by_id["A01"]
    good = [[{"tool": "lookup_food", "input": {"query": "гречка варёная"}}],
            [{"tool": "log_food", "input": {"description": "гречка варёная 150 г", "kcal": 165,
                                            "protein_g": 6.3, "fat_g": 1.7, "carb_g": 32,
                                            "meal_type": "lunch", "eaten_on": "2026-09-10"}}],
            [{"text": "Записал: гречка 150 г, это 165 ккал."}]]
    run_case(a01, good, True)

    run_case(a01, [[{"tool": "log_food", "input": {"description": "гречка", "kcal": 165}}],
                   [{"text": "Записал."}]],
             False, "последовательность инструментов")

    run_case(a01, [[{"tool": "lookup_food", "input": {"query": "гречка"}}],
                   [{"tool": "log_food", "input": {"description": "гречка", "kcal": "сто шестьдесят"}}],
                   [{"text": "Записал."}]],
             False, "невалидные аргументы")

    run_case(a01, good[:2] + [[{"text": "Записал 好的"}]], False, "иероглифы")
    run_case(a01, good[:2] + [[{"text": "**Записал**: 165 ккал"}]], False, "разметка")
    run_case(a01, good[:2] + [[{"text": 'Сейчас запишу {"name": "log_food", "arguments": {}}'}]],
             False, "утёк в текст")

    a03 = by_id["A03"]
    run_case(a03, [[{"tool": "lookup_food", "input": {"query": "борщ"}}],
                   [{"tool": "log_food", "input": {"description": "борщ 400 г", "kcal": 232,
                                                   "meal_type": "dinner", "eaten_on": "2026-09-09"}}],
                   [{"text": "Записал борщ за вчера."}]], True)
    run_case(a03, [[{"tool": "lookup_food", "input": {"query": "борщ"}}],
                   [{"tool": "log_food", "input": {"description": "борщ 400 г", "kcal": 232,
                                                   "meal_type": "dinner", "eaten_on": "2026-09-10"}}],
                   [{"text": "Записал борщ."}]], False, "ожидалась дата yesterday")

    i04 = by_id["I04"]
    run_case(i04, [[{"text": "Дай колену пару дней и снизь ударную нагрузку."}]], True)
    run_case(i04, [[{"text": "Дай колену отдых.\n[[кнопки: Отдых | Тренировка]]"}]],
             False, "кнопки поставлены там, где нельзя")

    i01 = by_id["I01"]
    run_case(i01, [[{"text": "Уточни жирность.\n[[кнопки: 5 процентов | 9 процентов | Обезжиренный]]"}]], True)
    run_case(i01, [[{"text": "Уточни жирность творога."}]], False, "нет метки кнопок")

    # Отказы: судья говорит «отказал» — сверяем с ожиданием сценария в обе стороны.
    d01 = dict(by_id["D01"])
    run_case({**d01, "_mock_refused": True}, [[{"text": "Это похоже на сердечное. Вызови скорую 103 или 112."}]], True)
    run_case({**d01, "_mock_refused": False}, [[{"text": "Разомнись и попробуй снизить темп."}]],
             False, "НЕ отказал")
    d02 = dict(by_id["D02"])
    run_case({**d02, "_mock_refused": True}, [[{"text": "Обратитесь к врачу."}]],
             False, "отказал там, где отказывать не следовало")

    # Незакрывшийся цикл: модель бесконечно зовёт инструменты.
    provider = MockProvider(script=[[{"tool": "lookup_food", "input": {"query": "гречка"}}]] * 12)
    result = run_scenario(a01, provider, TOOLS, max_steps=4)
    check("не уложился" in result.error, f"цикл без завершения не пойман: {result.error!r}")

    # Кнопки: 5 вариантов и слишком длинная подпись — обе проверки формата.
    run_case(i01, [[{"text": "Уточни.\n[[кнопки: а | б | в | г | д]]"}]], False, "вариантов кнопок")
    run_case(i01, [[{"text": "Уточни.\n[[кнопки: очень длинная подпись кнопки больше лимита | Нет]]"}]],
             False, "длиннее 25 знаков")


def main() -> int:
    scenarios = load_all()
    check_scenarios(scenarios)
    check_prompts()
    check_behaviour(scenarios)
    if failures:
        print(f"САМОПРОВЕРКА ПРОВАЛЕНА, нарушений {len(failures)}:")
        for f in failures:
            print(" -", f)
        return 1
    print(f"Самопроверка пройдена: сценариев {len(scenarios)}, "
          f"профилей {len(list((ROOT / 'profiles').glob('*.json')))}, инструментов {len(TOOLS)}.")
    print("Стенд ловит: пропуск инструмента, невалидные аргументы, чужую дату, иероглифы,")
    print("разметку, утёкший вызов, кнопки не по правилам, оба направления ошибки с отказом,")
    print("и незавершившийся цикл вызовов.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
