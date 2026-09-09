#!/usr/bin/env python3
"""Прогон проверочных сценариев через модель. Результат — JSON в out/.

    python3 run_eval.py --provider baseline --repeats 3
    python3 run_eval.py --provider vllm --only D,E,F --no-judge

Стенд не решает, годится ли модель — он собирает факты. Решают пороги в report.py.
"""
from __future__ import annotations

import argparse
import concurrent.futures as futures
import datetime as dt
import json
import pathlib
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from runner.loop import run_scenario
from runner.prompt_build import load_profile, parse_moment
from runner.providers import make_provider
from runner.scoring.judge import Judge, NoJudge
from runner.scoring.refusal import verdict

ROOT = pathlib.Path(__file__).resolve().parent


def load_scenarios(only: str | None, ids: str | None) -> list[dict]:
    items: list[dict] = []
    for path in sorted((ROOT / "scenarios").glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or []
        for s in data:
            s["_file"] = path.name
            items.append(s)
    seen = {}
    for s in items:
        if s["id"] in seen:
            raise SystemExit(f"дубль номера сценария {s['id']} в {s['_file']} и {seen[s['id']]}")
        seen[s["id"]] = s["_file"]
    if only:
        cats = {c.strip().upper() for c in only.split(",")}
        items = [s for s in items if s["id"][0].upper() in cats]
    if ids:
        want = {i.strip().upper() for i in ids.split(",")}
        items = [s for s in items if s["id"].upper() in want]
    return items


def main() -> int:
    ap = argparse.ArgumentParser(description="прогон сценариев проверки качества")
    ap.add_argument("--provider", default="baseline", help="имя провайдера из config.yaml")
    ap.add_argument("--repeats", type=int, default=None)
    ap.add_argument("--only", help="категории через запятую, например D,E,F")
    ap.add_argument("--ids", help="конкретные сценарии через запятую, например A01,D03")
    ap.add_argument("--no-judge", action="store_true", help="без судьи (без ключа Claude)")
    ap.add_argument("--out", help="путь к файлу результата")
    ap.add_argument("--workers", type=int, default=None)
    args = ap.parse_args()

    cfg = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
    if args.provider not in cfg["providers"]:
        raise SystemExit(f"нет провайдера {args.provider} в config.yaml")
    tools = json.loads((ROOT / "tools.json").read_text(encoding="utf-8"))
    scenarios = load_scenarios(args.only, args.ids)
    if not scenarios:
        raise SystemExit("под фильтр не попал ни один сценарий")

    repeats = args.repeats if args.repeats is not None else cfg["run"]["repeats"]
    workers = args.workers if args.workers is not None else cfg["run"]["workers"]
    max_steps = cfg["run"]["max_steps"]
    judge = NoJudge() if args.no_judge else Judge(**cfg["judge"])

    def one(task):
        scenario, rep = task
        provider = make_provider(cfg["providers"][args.provider])
        result = run_scenario(scenario, provider, tools, repeat=rep, max_steps=max_steps)
        today, _ = parse_moment(scenario.get("now", "2026-09-10 08:15"))
        judged = {"score": None, "refused": None, "why": "судья не вызывался"}
        if scenario.get("expect", {}).get("judge_rubric"):
            judged = judge.judge(
                user=scenario["user"],
                profile_note=load_profile(scenario["profile"]).get("note", ""),
                rubric=scenario["expect"]["judge_rubric"],
                answer=result.final_text,
                tools_used=result.tool_names,
            )
        return verdict(scenario, result, judged, today)

    tasks = [(s, r) for s in scenarios for r in range(repeats)]
    print(f"сценариев: {len(scenarios)} × {repeats} повторов = {len(tasks)} прогонов, "
          f"провайдер {args.provider}, судья {'выключен' if args.no_judge else cfg['judge']['model']}")

    rows, done = [], 0
    with futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for row in pool.map(one, tasks):
            rows.append(row)
            done += 1
            mark = "." if row["passed"] else "x"
            print(mark, end="", flush=True)
            if done % 60 == 0:
                print(f" {done}/{len(tasks)}", flush=True)
    print()

    out = pathlib.Path(args.out) if args.out else (
        ROOT / "out" / f"{args.provider}-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "provider": args.provider,
        "provider_config": cfg["providers"][args.provider],
        "judge": None if args.no_judge else cfg["judge"],
        "repeats": repeats,
        "scenarios": len(scenarios),
        "rows": rows,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print("результат ->", out)
    failed = sum(1 for r in rows if not r["passed"])
    print(f"прогонов: {len(rows)} | с нарушениями: {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
