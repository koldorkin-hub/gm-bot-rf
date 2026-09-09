"""Моки инструментов: проверка аргументов по JSON-схеме и детерминированный ответ.

Зачем валидация именно здесь. В РФ-версии первым узлом каждого подчинённого workflow
ставится проверка аргументов по схеме с ВОЗВРАТОМ ТЕКСТА ОШИБКИ модели — чтобы она
починила вызов сама (research/РФ-СТЕК-план.md, раздел «Что придётся переделать»).
Стенд повторяет это поведение: невалидный вызов не роняет сценарий, а возвращается
ошибкой — и одновременно попадает в метрику «доля валидных аргументов» (порог ≥ 97 %).
"""
from __future__ import annotations

import json
import pathlib
import re

from jsonschema import Draft202012Validator

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Сообщения jsonschema — английские, а узел валидации в n8n будет отвечать модели по-русски.
# Переводим здесь, чтобы стенд и боевой узел говорили одинаково: формулировка ошибки влияет
# на то, починит ли модель вызов со второй попытки.
RU_ERRORS = [
    (re.compile(r"'(?P<v>[^']*)' is a required property"), lambda m: f"обязательный параметр «{m['v']}» не передан"),
    (re.compile(r"'(?P<v>[^']*)' does not match '(?P<p>.*)'"), lambda m: f"значение «{m['v']}» не в требуемом формате ({m['p']})"),
    (re.compile(r"(?P<v>.*) is not of type '(?P<t>[^']*)'"), lambda m: f"значение {m['v']} должно быть типа {m['t']}"),
    (re.compile(r"(?P<v>.*) is not one of (?P<l>.*)"), lambda m: f"значение {m['v']} должно быть одним из {m['l']}"),
    (re.compile(r"Additional properties are not allowed \((?P<l>.*) (?:was|were) unexpected\)"), lambda m: f"переданы лишние параметры: {m['l']}"),
    (re.compile(r"(?P<v>.*) has too many items.*maximum (?P<n>\d+)"), lambda m: f"слишком много элементов, максимум {m['n']}"),
]


def _ru(message: str) -> str:
    for rx, fn in RU_ERRORS:
        m = rx.fullmatch(message)
        if m:
            return fn(m)
    return message


class ToolMock:
    def __init__(self, fixtures: dict | None = None):
        self.tools = {t["name"]: t for t in json.loads((ROOT / "tools.json").read_text("utf-8"))}
        self.validators = {n: Draft202012Validator(t["input_schema"]) for n, t in self.tools.items()}
        raw = json.loads((ROOT / "fixtures" / "tool_responses.json").read_text("utf-8"))
        self.fixtures = {k: v for k, v in raw.items() if not k.startswith("_")}
        if fixtures:  # переопределения из сценария
            self.fixtures = {**self.fixtures, **fixtures}

    def validate(self, name: str, args: dict) -> list[str]:
        """Список человеческих сообщений об ошибках; пустой — аргументы валидны."""
        if name not in self.validators:
            return [f"инструмента «{name}» не существует"]
        if not isinstance(args, dict):
            return ["аргументы должны быть объектом JSON"]
        errors = []
        for e in sorted(self.validators[name].iter_errors(args), key=lambda e: list(e.path)):
            path = ".".join(str(p) for p in e.path) or "(корень)"
            errors.append(f"{path}: {_ru(e.message)}")
        return errors

    def reply(self, name: str, args: dict) -> str:
        spec = self.fixtures.get(name)
        if spec is None:
            return f"инструмент «{name}» недоступен"
        blob_cache: dict[str, str] = {}
        for rule in spec.get("rules", []):
            arg = rule["arg"]
            if arg not in blob_cache:
                value = args.get(arg)
                blob_cache[arg] = json.dumps(value, ensure_ascii=False).lower() if value is not None else ""
            if rule["contains"].lower() in blob_cache[arg]:
                return rule["reply"]
        return spec.get("default", "готово")

    def call(self, name: str, args: dict) -> tuple[str, bool]:
        """Возвращает (текст для модели, валидны ли аргументы)."""
        errors = self.validate(name, args)
        if errors:
            return ("ОШИБКА ВЫЗОВА: " + "; ".join(errors)
                    + ". Исправь аргументы и вызови инструмент заново.", False)
        return self.reply(name, args), True
