"""Кандидаты: любой OpenAI-совместимый сервер — Cloud.ru, Yandex AI Studio, свой vLLM.

Один и тот же класс на все три случая: различаются base_url, модель и ключ. Так «переключатель
на Путь 2» (research/РФ-СТЕК-план.md) действительно оказывается сменой двух строк в config.yaml,
а не переписыванием стенда.

Намеренно без SDK openai: единственная зависимость — requests, и то же самое делает узел
HTTP Request в n8n. Если сервер вернёт вызов инструмента текстом (частая беда парсеров
tool calling у открытых моделей), это видно в тексте ответа и ловится проверкой формата.
"""
from __future__ import annotations

import json
import os
import time

import requests

from .base import Provider, Turn


class OpenAICompatProvider(Provider):
    def __init__(self, model: str, base_url: str, api_key_env: str = "OPENAI_API_KEY",
                 max_tokens: int = 4096, timeout: float = 120.0, temperature: float | None = None,
                 extra_body: dict | None = None, **_):
        self.name = f"openai:{model}"
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.temperature = temperature
        self.extra_body = extra_body or {}
        self.key = os.environ.get(api_key_env, "")
        if not self.key:
            raise RuntimeError(f"нет переменной окружения {api_key_env} — нечем ходить в {base_url}")
        self.session = requests.Session()

    # --- перевод внутреннего формата в формат OpenAI и обратно ---
    @staticmethod
    def _to_openai(system: str, messages: list[dict]) -> list[dict]:
        out = [{"role": "system", "content": system}]
        for m in messages:
            if m["role"] == "user":
                results = [b for b in m["content"] if b["type"] == "tool_result"]
                if results:
                    for b in results:
                        out.append({"role": "tool", "tool_call_id": b["tool_use_id"],
                                    "content": b["content"]})
                else:
                    out.append({"role": "user",
                                "content": "".join(b.get("text", "") for b in m["content"])})
            else:
                text = "".join(b.get("text", "") for b in m["content"] if b["type"] == "text")
                calls = [{"id": b["id"], "type": "function",
                          "function": {"name": b["name"], "arguments": json.dumps(b["input"], ensure_ascii=False)}}
                         for b in m["content"] if b["type"] == "tool_use"]
                msg = {"role": "assistant", "content": text or None}
                if calls:
                    msg["tool_calls"] = calls
                out.append(msg)
        return out

    def complete(self, system: str, messages: list[dict], tools: list[dict]) -> Turn:
        body = {
            "model": self.model,
            "messages": self._to_openai(system, messages),
            "tools": [{"type": "function", "function": {
                "name": t["name"], "description": t["description"], "parameters": t["input_schema"],
            }} for t in tools],
            "max_tokens": self.max_tokens,
            "stream": False,
            **self.extra_body,
        }
        if self.temperature is not None:
            body["temperature"] = self.temperature

        t0 = time.monotonic()
        r = self.session.post(f"{self.base_url}/chat/completions", json=body, timeout=self.timeout,
                              headers={"Authorization": f"Bearer {self.key}"})
        dt = time.monotonic() - t0
        if r.status_code != 200:
            raise RuntimeError(f"{self.base_url}: HTTP {r.status_code}: {r.text[:400]}")
        data = r.json()
        choice = data["choices"][0]
        msg = choice.get("message", {})

        calls = []
        for i, c in enumerate(msg.get("tool_calls") or []):
            fn = c.get("function", {})
            raw = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw) if isinstance(raw, str) else raw
            except json.JSONDecodeError:
                # Схлопнувшийся JSON — это тоже результат прогона, а не сбой стенда:
                # он должен попасть в метрику невалидных аргументов, а не оборвать сценарий.
                args = {"__invalid_json__": raw}
            calls.append({"id": c.get("id") or f"call_{i}", "name": fn.get("name", ""), "input": args})

        usage = data.get("usage") or {}
        return Turn(
            text=msg.get("content") or "",
            tool_calls=calls,
            stop_reason=choice.get("finish_reason", ""),
            latency_s=dt,
            usage={"input": usage.get("prompt_tokens", 0), "output": usage.get("completion_tokens", 0),
                   "cache_read": (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0),
                   "cache_write": 0},
            raw_assistant=msg,
        )
