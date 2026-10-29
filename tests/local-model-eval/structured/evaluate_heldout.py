"""Frozen held-out text pilot: rules, one-confirmation memory, whole-page UIE, candidate-line UIE.

The test rows are never used to choose labels, thresholds or snippets. This is
synthetic OCR-like text, so the output is diagnostic rather than deployment accuracy.
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
OUT = ROOT / "results" / "structured_eval"


def compact(value: object) -> str:
    return re.sub(r"[^0-9a-z]", "", str(value).casefold())


def source_candidates(row: dict, field: dict) -> list[dict]:
    kind = "date" if field["type"] == "date" else "amount"
    lines = row["text"].split("\n")
    grouped: dict[tuple[int, int, int], dict] = {}
    for candidate in row["candidates"]:
        if candidate["kind"] != kind:
            continue
        at = candidate["line"], candidate["start"], candidate["end"]
        item = grouped.setdefault(at, {"raw": candidate["raw"], "values": set(),
                                       "line": candidate["line"]})
        item["values"].add(candidate["value"])
    sources = []
    for item in grouped.values():
        line = lines[item["line"]]
        snippet = line if len(line.strip()) >= 20 or item["line"] == 0 else lines[item["line"] - 1] + "\n" + line
        sources.append({"raw": item["raw"], "values": sorted(item["values"]),
                        "line": item["line"], "snippet": snippet})
    return sources


def equals(field: dict, truth: object, got: object) -> bool:
    if field["type"] == "money":
        return abs(float(truth) - float(got)) < .005
    return truth == got


def grade(field: dict, truth: object, selected: dict | None) -> str:
    if selected is None:
        return "emptyOk" if truth is None else "empty"
    if truth is None:
        return "filledNull"
    values = selected["values"]
    if len(values) != 1:
        return "ambiguousSource" if truth in values else "wrongSource"
    return "correct" if equals(field, truth, values[0]) else "wrong"


def grade_code(field: dict, truth: object, code_value: dict | None) -> str:
    if code_value is None:
        return "emptyOk" if truth is None else "empty"
    if truth is None:
        return "filledNull"
    return "correct" if equals(field, truth, code_value["value"]) else "wrong"


def whole_page_source(row: dict, span: dict, sources: list[dict]) -> dict | None:
    line = row["text"][:max(0, span.get("start", 0))].count("\n")
    matches = [source for source in sources if source["line"] == line
               and len(compact(source["raw"])) >= 3
               and compact(source["raw"]) in compact(span["text"])]
    if not matches:
        return None
    return max(matches, key=lambda item: len(compact(item["raw"])))


def failure_stage(result: str, truth: object, sources: list[dict], field: dict,
                  selected: dict | None, has_span: bool) -> str | None:
    if result in ("correct", "emptyOk"):
        return None
    if truth is None:
        return "falseFill"
    recall = any(any(equals(field, truth, value) for value in source["values"])
                 for source in sources)
    if not recall:
        return "candidateMiss"
    if selected is None:
        return "spanUnmapped" if has_span else "modelAbstain"
    if result == "ambiguousSource":
        return "dateOrderAmbiguous"
    return "wrongCandidate"


def run(lang: str, absence: bool) -> None:
    from paddlenlp import Taskflow

    dataset = "heldout_absence_pairs" if absence else "heldout_pairs"
    source = ROOT / "results" / f"{dataset}_export.json"
    rows = [row for row in json.loads(source.read_text(encoding="utf-8")) if row["lang"] == lang]
    model = Taskflow("information_extraction", schema=["placeholder"], model="uie-m-base",
                     schema_lang="zh" if lang == "zh" else "en", device="cpu")
    details = []
    times = []
    for row in rows:
        labels = [field["name"] for field in row["fields"]]
        model.set_schema(labels)
        t0 = time.perf_counter()
        page_output = model(row["text"])[0]
        page_s = time.perf_counter() - t0
        for field in row["fields"]:
            if field["type"] not in ("date", "money"):
                continue
            truth = row["truth"].get(field["id"])
            sources = source_candidates(row, field)
            recall = truth is None or any(
                any(equals(field, truth, value) for value in source["values"])
                for source in sources
            )
            for method, value in (("rules", row["rules"].get(field["id"])),
                                  ("memory", row["memory"].get(field["id"]))):
                result = grade_code(field, truth, value)
                details.append({"id": row["id"], "kind": row["kind"], "lang": lang,
                                "field": field["id"], "type": field["type"], "method": method,
                                "truth": truth, "got": value["value"] if value else None,
                                "result": result, "candidateRecall": recall,
                                "stage": None if result in ("correct", "emptyOk") else
                                "candidateMiss" if not recall else "ruleOrMemorySelection"})
            spans = sorted(page_output.get(field["name"], []),
                           key=lambda span: -span["probability"])
            top = spans[0] if spans else None
            page_selected = whole_page_source(row, top, sources) if top else None
            result = grade(field, truth, page_selected)
            details.append({"id": row["id"], "kind": row["kind"], "lang": lang,
                            "field": field["id"], "type": field["type"], "method": "uie_page",
                            "truth": truth, "span": top["text"] if top else None,
                            "got": page_selected["values"] if page_selected else None,
                            "result": result, "candidateRecall": recall,
                            "stage": failure_stage(result, truth, sources, field, page_selected, bool(top))})
            model.set_schema([field["name"]])
            t0 = time.perf_counter()
            for source in sources:
                output = model(source["snippet"])[0].get(field["name"], [])
                matched = [span for span in output if compact(source["raw"])
                           and compact(source["raw"]) in compact(span["text"])]
                source["score"] = max((span["probability"] for span in matched), default=None)
            candidate_s = time.perf_counter() - t0
            scored = [source for source in sources if source["score"] is not None]
            selected = max(scored, key=lambda source: source["score"]) if scored else None
            result = grade(field, truth, selected)
            details.append({"id": row["id"], "kind": row["kind"], "lang": lang,
                            "field": field["id"], "type": field["type"], "method": "uie_candidates",
                            "truth": truth, "got": selected["values"] if selected else None,
                            "selectedLine": selected["line"] if selected else None,
                            "result": result, "candidateRecall": recall,
                            "stage": failure_stage(result, truth, sources, field, selected, bool(scored))})
            times.append({"id": row["id"], "field": field["id"], "page_s": page_s,
                          "candidate_s": candidate_s, "candidateCount": len(sources)})
        print(row["id"], flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{dataset}_{lang}.json"
    path.write_text(json.dumps({"lang": lang, "details": details, "times": times},
                               ensure_ascii=False, indent=2), encoding="utf-8")
    print("saved", path)
    for method in ("rules", "memory", "uie_page", "uie_candidates"):
        subset = [detail for detail in details if detail["method"] == method]
        print(lang, method, dict(Counter(detail["result"] for detail in subset)))
    print(lang, "candidate_recall", sum(detail["candidateRecall"] for detail in details
                                        if detail["method"] == "uie_candidates"), "/",
          len([detail for detail in details if detail["method"] == "uie_candidates"]))
    print(lang, "candidate_p50_s_per_field",
          round(statistics.median(item["candidate_s"] for item in times), 3))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=("zh", "en", "fr"), required=True)
    parser.add_argument("--absence", action="store_true")
    args = parser.parse_args()
    run(args.lang, args.absence)
