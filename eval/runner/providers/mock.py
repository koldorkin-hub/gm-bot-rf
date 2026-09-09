"""Мок-модель для самопроверки стенда: отвечает по сценарию, без сети и без денег.

Нужен, чтобы проверить сам стенд — что он ловит и правильное поведение, и каждый вид
нарушения (пропущенный инструмент, кривой аргумент, иероглифы, разметку, лишние кнопки).
Без такой проверки «стенд отработал успешно» ничего не значит.
"""
from __future__ import annotations

from .base import Provider, Turn


class MockProvider(Provider):
    name = "mock"

    def __init__(self, script: list[list[dict]] | None = None, **_):
        # script — список ходов; каждый ход: [{"text": ...}, {"tool": "имя", "input": {...}}, ...]
        self.script = script or []
        self.step = 0

    def complete(self, system: str, messages: list[dict], tools: list[dict]) -> Turn:
        move = self.script[self.step] if self.step < len(self.script) else [{"text": "готово"}]
        self.step += 1
        text = "".join(b.get("text", "") for b in move if "text" in b)
        calls = [{"id": f"mock_{self.step}_{i}", "name": b["tool"], "input": b.get("input", {})}
                 for i, b in enumerate(move) if "tool" in b]
        return Turn(text=text, tool_calls=calls,
                    stop_reason="tool_use" if calls else "end_turn",
                    latency_s=0.0, usage={"input": 0, "output": 0, "cache_read": 0, "cache_write": 0})
