"""Проверки формата ответа: иероглифы, разметка, кнопки, срыв вызова инструмента в текст.

Всё это — известные болезни открытых моделей и уже случавшиеся дефекты действующего бота
(knowledge/memory/tool-call-leak.md, inline-buttons.md). Проверки детерминированные:
судью на такое звать незачем.
"""
from __future__ import annotations

import re

CJK = re.compile(r"[一-鿿぀-ヿ가-힯]")
MARKDOWN = re.compile(r"(\*\*|^#{1,3} |^\s*[-*] |^\s*\d+\.\s)", re.M)
# Парсер боевого бота терпим к форме метки (без закрывающих скобок, латиницей, дубли) —
# стенд обязан быть терпим так же, иначе он забракует ответ, который в Telegram отработал бы.
BUTTONS = re.compile(r"\[\[\s*(?:кнопк[а-яё]*|knopki|buttons)\s*:\s*([^\]\n]+)\]?\]?\s*$", re.I | re.M)
# Срыв генерации: модель пишет вызов инструмента текстом вместо структурного вызова.
LEAK = re.compile(r"(<tool_call>|<function|```json\s*\{\s*\"(name|tool|tool_name)\"|"
                  r"\{\s*\"(name|tool_name)\"\s*:\s*\"[a-z_]+\"\s*,\s*\"(input|arguments|parameters)\")", re.I)
LATIN_WORD = re.compile(r"\b[A-Za-z]{4,}\b")


def _last_button_match(text: str):
    m = None
    for m in BUTTONS.finditer(text):
        pass
    return m


def buttons_line(text: str) -> str | None:
    m = _last_button_match(text)
    return m.group(1) if m else None


def check(text: str, buttons: str = "optional") -> list[str]:
    """buttons: required | forbidden | optional. Возвращает список нарушений."""
    problems = []
    if not text.strip():
        problems.append("пустой ответ клиенту")
        return problems
    if CJK.search(text):
        problems.append("в ответе иероглифы (CJK)")
    body = BUTTONS.sub("", text)
    if MARKDOWN.search(body):
        problems.append("в ответе разметка markdown — в Telegram она не работает")
    if LEAK.search(text):
        problems.append("вызов инструмента утёк в текст ответа")

    line = buttons_line(text)
    if buttons == "required" and line is None:
        problems.append("нет метки кнопок, а вопрос предполагает выбор")
    if buttons == "forbidden" and line is not None:
        problems.append(f"кнопки поставлены там, где нельзя: [[кнопки: {line}]]")
    if line is not None:
        options = [o.strip() for o in line.split("|") if o.strip()]
        if not 2 <= len(options) <= 4:
            problems.append(f"вариантов кнопок {len(options)}, допустимо 2–4")
        long = [o for o in options if len(o) > 25]
        if long:
            problems.append(f"подпись кнопки длиннее 25 знаков: {long[0]!r}")
        if _last_button_match(text).end() < len(text.rstrip()):
            problems.append("метка кнопок не последней строкой")
    return problems


def latin_ratio(text: str) -> float:
    """Доля латинских слов — грубый признак сползания в английский на русском вопросе."""
    words = re.findall(r"\b[\w'-]{4,}\b", text, re.UNICODE)
    return len(LATIN_WORD.findall(text)) / len(words) if words else 0.0
