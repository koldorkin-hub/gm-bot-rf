"""Общий вид ответа модели. Внутренний формат один, провайдеры переводят в него свой.

Формат сообщений внутри стенда (он же формат Anthropic, как более выразительный):
  {"role": "user",      "content": [{"type": "text", "text": "..."}]}
  {"role": "assistant", "content": [{"type": "text", "text": "..."},
                                    {"type": "tool_use", "id": "...", "name": "...", "input": {...}}]}
  {"role": "user",      "content": [{"type": "tool_result", "tool_use_id": "...",
                                     "content": "...", "is_error": false}]}
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Turn:
    text: str = ""
    tool_calls: list[dict] = field(default_factory=list)   # [{"id","name","input"}]
    stop_reason: str = ""
    latency_s: float = 0.0
    usage: dict = field(default_factory=dict)
    raw_assistant: list | None = None                       # блоки ответа как их вернул провайдер


class Provider:
    """Базовый провайдер. Реализация обязана быть без состояния между сценариями."""

    name = "base"

    def complete(self, system: str, messages: list[dict], tools: list[dict]) -> Turn:
        raise NotImplementedError

    def close(self) -> None:
        pass
