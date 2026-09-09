"""Эталон: Claude через официальный SDK. Нужен только для baseline-прогона и судьи.

Кэш префикса включён (cache_control на схемах инструментов и на системнике): системник
и 20 схем одинаковы во всех сценариях одного профиля, а платить за них по 90×3 раза
незачем. Проверять попадание — по usage.cache_read_input_tokens в отчёте.
"""
from __future__ import annotations

import os
import time

import anthropic

from .base import Provider, Turn


class AnthropicProvider(Provider):
    def __init__(self, model: str, max_tokens: int = 4096, timeout: float = 120.0,
                 effort: str | None = None, cache: bool = True, **_):
        self.name = f"anthropic:{model}"
        self.model = model
        self.max_tokens = max_tokens
        self.effort = effort
        self.cache = cache
        if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
            raise RuntimeError("нет ANTHROPIC_API_KEY — эталонный прогон запускать нечем")
        self.client = anthropic.Anthropic(timeout=timeout, max_retries=3)

    def complete(self, system: str, messages: list[dict], tools: list[dict]) -> Turn:
        tool_defs = [{"name": t["name"], "description": t["description"],
                      "input_schema": t["input_schema"]} for t in tools]
        if self.cache:
            # Точка кэша — в конце неизменного префикса: схемы инструментов + системник.
            tool_defs[-1] = {**tool_defs[-1], "cache_control": {"type": "ephemeral"}}
        sys_blocks = [{"type": "text", "text": system}]
        if self.cache:
            sys_blocks[0]["cache_control"] = {"type": "ephemeral"}

        params = dict(model=self.model, max_tokens=self.max_tokens,
                      system=sys_blocks, messages=messages, tools=tool_defs)
        if self.effort:
            params["output_config"] = {"effort": self.effort}

        t0 = time.monotonic()
        resp = self.client.messages.create(**params)
        dt = time.monotonic() - t0

        text = "".join(b.text for b in resp.content if b.type == "text")
        calls = [{"id": b.id, "name": b.name, "input": b.input}
                 for b in resp.content if b.type == "tool_use"]
        usage = {
            "input": resp.usage.input_tokens,
            "output": resp.usage.output_tokens,
            "cache_read": getattr(resp.usage, "cache_read_input_tokens", 0) or 0,
            "cache_write": getattr(resp.usage, "cache_creation_input_tokens", 0) or 0,
        }
        return Turn(text=text, tool_calls=calls, stop_reason=resp.stop_reason or "",
                    latency_s=dt, usage=usage,
                    raw_assistant=[b.model_dump(exclude_none=True) for b in resp.content])
