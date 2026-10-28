"""Kev 官方 LocalPredictor 的文件类别决策测试。"""
from __future__ import annotations

import argparse
import json
import sys
import time
import types
from pathlib import Path

from evaluate import CASES, KINDS, LANG_INDEX, TOPICS, choices, damaged_text
if sys.platform == "win32":
    # Kev 的 suite 模块在导入时要求 Unix fcntl；本脚本不写它的 suite 缓存。
    sys.modules.setdefault("fcntl", types.SimpleNamespace(LOCK_EX=2, flock=lambda *_: None))
from kev.predictors import LocalPredictor

ROOT = Path(__file__).resolve().parents[1]
INSTRUCTIONS = {
    "kind": "Which document kind best describes the OCR text? Select format, not subject.",
    "topic": "Which subject best describes the OCR text? Select subject, not format.",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--facet", choices=("kind", "topic"), required=True)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--noise", action="store_true")
    parser.add_argument("--english-criteria", action="store_true")
    parser.add_argument("--short-criteria", action="store_true")
    parser.add_argument("--run", default="jaredpalmer/kev-0.8b@v1.0")
    args = parser.parse_args()
    output = ROOT / "results/classification"
    output.mkdir(parents=True, exist_ok=True)
    suffix = ("-noise" if args.noise else "") + ("-english-criteria" if args.english_criteria else "") + ("-short-criteria" if args.short_criteria else "")
    path = output / f"kev-08b-{args.facet}{suffix}.jsonl"
    done = {json.loads(line)["id"] for line in path.read_text(encoding="utf-8").splitlines() if line} if path.exists() else set()
    predictor = LocalPredictor(args.run, "cpu")
    cases = CASES[:args.limit] if args.limit else CASES
    with path.open("a", encoding="utf-8") as stream:
        for case in cases:
            if case["id"] in done:
                continue
            state = damaged_text(case) if args.noise else case["text"]
            if not state.strip():
                row = {"id": case["id"], "lang": case["lang"], "facet": args.facet,
                       "truth": case[args.facet], "predicted": "unknown", "guarded_empty": True}
            else:
                criteria_lang = "en" if args.english_criteria else case["lang"]
                criteria = ({key: names[LANG_INDEX[criteria_lang]] for key, names in
                             (KINDS if args.facet == "kind" else TOPICS).items()}
                            if args.short_criteria else dict(choices(args.facet, criteria_lang)))
                truth = case[args.facet]
                record = {"state": state, "questions": {args.facet: {"type": "choice",
                           "instructions": INSTRUCTIONS[args.facet], "criteria": criteria,
                           "label": truth if truth in criteria else next(iter(criteria)), "src": "morph-synthetic"}}}
                t0 = time.monotonic()
                result = predictor(record)
                probabilities = result["probabilities"][args.facet]
                row = {"id": case["id"], "lang": case["lang"], "facet": args.facet,
                       "truth": truth, "predicted": max(probabilities, key=probabilities.get),
                       "probabilities": probabilities, "elapsed_s": time.monotonic() - t0,
                       "model_latency_ms": result["latency_ms"], "input_tokens": result["input_tokens"]}
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            stream.flush()
            print(case["id"], row["predicted"], flush=True)


if __name__ == "__main__":
    main()
