"""Агентный цикл вне n8n: сценарий → диалог с моками инструментов → запись хода.

Проверяется ПОВЕДЕНИЕ (какой инструмент, какие аргументы, отказ, формат, задержка),
а не похожесть текста на ответ Claude: Claude здесь эталон, а не истина.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from .prompt_build import load_profile, parse_moment, stamp, system_message
from .providers import Provider
from .tools_mock import ToolMock


@dataclass
class Call:
    name: str
    input: dict
    valid: bool
    error: str = ""


@dataclass
class RunResult:
    scenario_id: str
    repeat: int
    provider: str
    calls: list[Call] = field(default_factory=list)
    final_text: str = ""
    turns: int = 0
    latency_first_s: float = 0.0
    latency_total_s: float = 0.0
    usage: dict = field(default_factory=lambda: {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0})
    transcript: list = field(default_factory=list)
    error: str = ""

    @property
    def tool_names(self) -> list[str]:
        return [c.name for c in self.calls]


def build_history(scenario: dict, today: dt.date, clock: str) -> list[dict]:
    """История диалога до проверяемой реплики.

    Штампы у старых сообщений намеренно СТАРЫЕ: по правилу блока ДАТА они «история, не
    сегодня», и категория J проверяет, что модель не примет их за текущую дату.
    """
    messages: list[dict] = []
    filler = scenario.get("filler")
    if filler:
        n = int(filler["turns"])
        for i in range(n):
            day = today - dt.timedelta(days=(n - i + 1) // 2)
            messages.append({"role": "user", "content": [{"type": "text", "text":
                f"{stamp(day, clock)} {filler['user'][i % len(filler['user'])]}"}]})
            messages.append({"role": "assistant", "content": [{"type": "text", "text":
                filler["bot"][i % len(filler["bot"])]}]})
    for turn in scenario.get("history", []):
        if "user" in turn:
            day = today - dt.timedelta(days=int(turn.get("days_ago", 0)))
            messages.append({"role": "user", "content": [{"type": "text", "text":
                f"{stamp(day, turn.get('clock', clock))} {turn['user']}"}]})
        else:
            messages.append({"role": "assistant", "content": [{"type": "text", "text": turn["bot"]}]})
    return messages


def run_scenario(scenario: dict, provider: Provider, tools: list[dict], repeat: int = 0,
                 max_steps: int = 8) -> RunResult:
    profile = load_profile(scenario["profile"])
    today, clock = parse_moment(scenario.get("now", "2026-09-10 08:15"))
    system = system_message(profile, today, clock)
    mock = ToolMock(scenario.get("fixtures"))

    messages = build_history(scenario, today, clock)
    messages.append({"role": "user", "content": [{"type": "text", "text":
        f"{stamp(today, clock)} {scenario['user']}"}]})

    result = RunResult(scenario_id=scenario["id"], repeat=repeat, provider=provider.name)
    try:
        for step in range(max_steps):
            turn = provider.complete(system, messages, tools)
            result.turns += 1
            result.latency_total_s += turn.latency_s
            if step == 0:
                result.latency_first_s = turn.latency_s
            for k in result.usage:
                result.usage[k] += turn.usage.get(k, 0)
            result.transcript.append({"assistant_text": turn.text,
                                      "tool_calls": turn.tool_calls,
                                      "stop_reason": turn.stop_reason,
                                      "latency_s": round(turn.latency_s, 2)})
            if not turn.tool_calls:
                result.final_text = turn.text
                break

            messages.append({"role": "assistant", "content":
                ([{"type": "text", "text": turn.text}] if turn.text else [])
                + [{"type": "tool_use", "id": c["id"], "name": c["name"], "input": c["input"]}
                   for c in turn.tool_calls]})
            results = []
            for c in turn.tool_calls:
                reply, ok = mock.call(c["name"], c["input"])
                result.calls.append(Call(name=c["name"], input=c["input"], valid=ok,
                                         error="" if ok else reply))
                results.append({"type": "tool_result", "tool_use_id": c["id"],
                                "content": reply, "is_error": not ok})
            messages.append({"role": "user", "content": results})
            result.transcript.append({"tool_results": [r["content"] for r in results]})
        else:
            # Цикл не сошёлся за max_steps — это дефект поведения, а не сбой стенда.
            result.final_text = ""
            result.error = f"не уложился в {max_steps} ходов"
    except Exception as e:  # сбой сети/провайдера: сценарий помечается, прогон продолжается
        result.error = f"{type(e).__name__}: {e}"
    return result
