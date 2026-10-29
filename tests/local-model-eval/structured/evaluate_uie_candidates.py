"""Score each grounded amount/date source separately with UIE-M-base.

Only OCR text, candidate source lines, field names and purpose descriptions are
sent to the model. Truth is consulted after all candidate scores are produced.
Scores across separate UIE calls may not be calibrated; this is exploratory.
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROWS = json.loads((ROOT / "results" / "diverse_export.json").read_text(encoding="utf-8"))
MEANINGS = json.loads((ROOT / "prefill" / "field_meanings.json").read_text(encoding="utf-8"))
OUT = ROOT / "results" / "structured_eval"


def compact(s: str) -> str:
    return re.sub(r"[^0-9a-z]", "", s.casefold())


def sources(row: dict, field: dict) -> list[dict]:
    kind = "date" if field["type"] == "date" else "amount"
    lines = row["text"].split("\n")
    grouped = {}
    for candidate in row["candidates"]:
        if candidate["kind"] != kind:
            continue
        at = (candidate["line"], candidate["start"], candidate["end"])
        item = grouped.setdefault(at, {"raw": candidate["raw"], "values": set(),
                                       "line": candidate["line"]})
        item["values"].add(candidate["value"])
    found = []
    for _, item in sorted(grouped.items()):
        line = lines[item["line"]]
        snippet = line if len(line.strip()) >= 20 or item["line"] == 0 else lines[item["line"] - 1] + "\n" + line
        found.append({"raw": item["raw"], "values": sorted(item["values"]),
                      "line": item["line"], "snippet": snippet})
    return found


def grade(truth, field: dict, selected: dict | None) -> str:
    if selected is None:
        return "emptyOk" if truth is None else "empty"
    values = selected["values"]
    if len(values) != 1:
        return "ambiguousSource" if truth in values else "wrongSource"
    if truth is None:
        return "filledNull"
    if field["type"] == "money":
        return "correct" if abs(float(truth) - float(values[0])) < .005 else "wrong"
    return "correct" if truth == values[0] else "wrong"


def run(lang: str, mode_set: str) -> None:
    from paddlenlp import Taskflow

    rows = [row for row in ROWS if row["lang"] == lang]
    model = Taskflow("information_extraction", schema=["placeholder"], model="uie-m-base",
                     schema_lang="zh" if lang == "zh" else "en", device="cpu")
    details = []
    times = []
    for row in rows:
        for field in row["fields"]:
            if field["type"] not in ("date", "money"):
                continue
            candidates = sources(row, field)
            label_kinds = ("name", "combined") if mode_set == "original" else ("generic", "generic_combined")
            for labels_kind in label_kinds:
                generic = ("日期" if lang == "zh" else "Date") if field["type"] == "date" else (
                    "金额" if lang == "zh" else "Montant" if lang == "fr" else "Amount")
                label = (field["name"] if labels_kind == "name" else
                         f"{field['name']}: {MEANINGS[row['id']][field['id']]}" if labels_kind == "combined" else
                         generic if labels_kind == "generic" else
                         f"{generic}: {MEANINGS[row['id']][field['id']]}")
                model.set_schema([label])
                t0 = time.perf_counter()
                for candidate in candidates:
                    output = model(candidate["snippet"])[0].get(label, [])
                    matched = [span for span in output
                               if compact(candidate["raw"]) and compact(candidate["raw"]) in compact(span["text"])]
                    candidate[f"score_{labels_kind}"] = max((span["probability"] for span in matched), default=None)
                times.append(time.perf_counter() - t0)
                scored = [c for c in candidates if c[f"score_{labels_kind}"] is not None]
                selected = max(scored, key=lambda c: c[f"score_{labels_kind}"]) if scored else None
                truth = row["truth"].get(field["id"])
                details.append({"id": row["id"], "field": field["id"], "type": field["type"],
                                "labels": labels_kind, "truth": truth,
                                "result": grade(truth, field, selected),
                                "selected": selected, "candidates": candidates})
        print(row["id"], flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"uie_candidate_lines_{lang}_{mode_set}.json").write_text(
        json.dumps({"lang": lang, "p50_s_per_field": statistics.median(times),
                    "details": details}, ensure_ascii=False, indent=2), encoding="utf-8")
    for labels_kind in (("name", "combined") if mode_set == "original" else ("generic", "generic_combined")):
        subset = [d for d in details if d["labels"] == labels_kind]
        print(lang, labels_kind, dict(Counter(d["result"] for d in subset)))
        for d in subset:
            if d["result"] not in ("correct", "emptyOk", "ambiguousSource"):
                print("MISS", d["id"], d["field"], d["result"],
                      d["selected"]["snippet"] if d["selected"] else None)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=("zh", "en", "fr"), required=True)
    parser.add_argument("--mode-set", choices=("original", "generic"), default="original")
    args = parser.parse_args()
    run(args.lang, args.mode_set)
