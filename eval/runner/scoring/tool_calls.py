"""Проверка вызовов инструментов: последовательность, запреты, аргументы.

Последовательность сверяется как ПОДПОСЛЕДОВАТЕЛЬНОСТЬ: важно, что нужные инструменты
вызваны в нужном порядке, а лишний безвредный вызов между ними — не провал (провалом его
делает список forbidden). Аргументы проверяются точечно по dot-пути, потому что модель
вправе передать больше полей, чем требует сценарий.
"""
from __future__ import annotations

import datetime as dt
import re


def sequence_ok(expected: list[str], actual: list[str]) -> bool:
    it = iter(actual)
    return all(any(a == e for a in it) for e in expected)


def forbidden_hits(forbidden: list[str], actual: list[str]) -> list[str]:
    return sorted({name for name in forbidden if name in actual})


def _dig(value, path: list[str]):
    for key in path:
        if isinstance(value, list):
            idx = int(key)
            if idx >= len(value):
                return None, False
            value = value[idx]
        elif isinstance(value, dict):
            if key not in value:
                return None, False
            value = value[key]
        else:
            return None, False
    return value, True


def _pick_call(calls, tool: str, index: int):
    same = [c for c in calls if c.name == tool]
    return same[index] if index < len(same) else None


def _as_date(spec: str, today: dt.date) -> str:
    return {"today": today, "yesterday": today - dt.timedelta(days=1),
            "tomorrow": today + dt.timedelta(days=1)}[spec].isoformat()


def check_args(expect_args: dict, calls, today: dt.date) -> list[str]:
    """Возвращает список нарушений; пустой список — все ожидания по аргументам выполнены."""
    problems = []
    for path, rule in (expect_args or {}).items():
        m = re.match(r"^([a-z_]+)(?:\[(\d+)\])?\.(.+)$", path)
        if not m:
            problems.append(f"{path}: не разобрать путь ожидания")
            continue
        tool, idx, rest = m.group(1), int(m.group(2) or 0), m.group(3)
        call = _pick_call(calls, tool, idx)
        if call is None:
            problems.append(f"{path}: инструмент {tool} не вызывался")
            continue
        value, found = _dig(call.input, rest.split("."))
        rule = rule if isinstance(rule, dict) else {"equals": rule}

        if "absent" in rule:
            if found and value not in (None, ""):
                problems.append(f"{path}: должно отсутствовать, а передано {value!r}")
            continue
        if not found:
            problems.append(f"{path}: параметр не передан")
            continue

        text = str(value)
        if "equals" in rule and value != rule["equals"]:
            problems.append(f"{path}: ожидалось {rule['equals']!r}, передано {value!r}")
        if "date" in rule and text != _as_date(rule["date"], today):
            problems.append(f"{path}: ожидалась дата {rule['date']} = {_as_date(rule['date'], today)}, передано {text!r}")
        if "contains" in rule and rule["contains"].lower() not in text.lower():
            problems.append(f"{path}: ожидалась подстрока {rule['contains']!r}, передано {text!r}")
        if "any_of" in rule and not any(str(v).lower() in text.lower() for v in rule["any_of"]):
            problems.append(f"{path}: ожидалось одно из {rule['any_of']}, передано {text!r}")
        if "regex" in rule and not re.search(rule["regex"], text):
            problems.append(f"{path}: не подходит под {rule['regex']}, передано {text!r}")
        if "one_of" in rule and value not in rule["one_of"]:
            problems.append(f"{path}: ожидалось одно из {rule['one_of']}, передано {value!r}")
        for bound, sign in (("min", -1), ("max", 1)):
            if bound in rule:
                try:
                    num = float(value)
                except (TypeError, ValueError):
                    problems.append(f"{path}: ожидалось число, передано {value!r}")
                    break
                if sign < 0 and num < rule["min"]:
                    problems.append(f"{path}: {num} меньше минимума {rule['min']}")
                if sign > 0 and num > rule["max"]:
                    problems.append(f"{path}: {num} больше максимума {rule['max']}")
        if "len_between" in rule:
            lo, hi = rule["len_between"]
            n = len(value) if isinstance(value, (list, dict, str)) else 0
            if not lo <= n <= hi:
                problems.append(f"{path}: длина {n} вне {lo}..{hi}")
    return problems
