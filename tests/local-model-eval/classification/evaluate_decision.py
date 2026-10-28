"""Jev 式开放候选决策模型的同题测试；原始输出写入忽略的 results/。"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

from evaluate import CASES, KINDS, LANG_INDEX, TOPICS, choices, damaged_text

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results/classification"
INSTRUCTIONS = {
    "kind": "What kind of document is this? Choose the document format, not the topic.",
    "topic": "What is the main topic of this document? Choose its subject, not its format.",
}
UNKNOWN = {"zh": "文字不可读或证据不足，无法判断", "en": "Unreadable text or insufficient evidence to determine a category",
           "fr": "Texte illisible ou preuves insuffisantes pour déterminer une catégorie"}


def questions_for(lang: str, english_criteria: bool, short_criteria: bool,
                  unknown_option: bool = False) -> dict:
    criteria_lang = "en" if english_criteria else lang
    questions = {}
    for facet in ("kind", "topic"):
        criteria = ({key: names[LANG_INDEX[criteria_lang]] for key, names in
                     (KINDS if facet == "kind" else TOPICS).items()}
                    if short_criteria else dict(choices(facet, criteria_lang)))
        if unknown_option:
            criteria["unknown"] = UNKNOWN[criteria_lang]
        instruction = INSTRUCTIONS[facet] + (" If evidence is unreadable or insufficient, choose unknown."
                                           if unknown_option else "")
        questions[facet] = {"type": "choice", "instructions": instruction, "criteria": criteria}
    return questions


def run_laya(model_path: str, noise: bool, english_criteria: bool,
             short_criteria: bool, unknown_option: bool) -> None:
    os.environ.setdefault("USE_TF", "0")
    import laya

    agent = laya.load(model_path)
    RESULTS.mkdir(parents=True, exist_ok=True)
    suffix = (("-noise" if noise else "") + ("-english-criteria" if english_criteria else "")
              + ("-short-criteria" if short_criteria else "") + ("-unknown-option" if unknown_option else ""))
    path = RESULTS / f"laya-multilingual{suffix}.jsonl"
    done = {json.loads(line)["id"] for line in path.read_text(encoding="utf-8").splitlines() if line} if path.exists() else set()
    with path.open("a", encoding="utf-8") as stream:
        for case in CASES:
            if case["id"] in done:
                continue
            state = damaged_text(case) if noise else case["text"]
            if not state.strip():
                # 两条非空但不可读的样本仍送模型；完全空白直接记拒判。
                row = {"id": case["id"], "lang": case["lang"], "truth_kind": case["kind"],
                       "truth_topic": case["topic"], "predicted_kind": "unknown", "predicted_topic": "unknown",
                       "guarded_empty": True, "elapsed_s": 0.0}
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
                stream.flush()
                continue
            t0 = time.monotonic()
            reply = agent.predict(state, questions_for(case["lang"], english_criteria,
                                                      short_criteria, unknown_option))
            elapsed = time.monotonic() - t0
            answers = reply["answers"]
            row = {"id": case["id"], "lang": case["lang"], "truth_kind": case["kind"],
                   "truth_topic": case["topic"], "predicted_kind": answers["kind"]["choice"],
                   "predicted_topic": answers["topic"]["choice"],
                   "probabilities_kind": answers["kind"]["probabilities"],
                   "probabilities_topic": answers["topic"]["probabilities"],
                   "elapsed_s": elapsed, "usage": reply.get("usage")}
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            stream.flush()
            print(case["id"], row["predicted_kind"], row["predicted_topic"], flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=("laya-multilingual",), required=True)
    parser.add_argument("--noise", action="store_true")
    parser.add_argument("--english-criteria", action="store_true")
    parser.add_argument("--short-criteria", action="store_true")
    parser.add_argument("--unknown-option", action="store_true")
    args = parser.parse_args()
    if args.model == "laya-multilingual":
        run_laya(str(ROOT / "models/cls-laya-multilingual"), args.noise,
                 args.english_criteria, args.short_criteria, args.unknown_option)
