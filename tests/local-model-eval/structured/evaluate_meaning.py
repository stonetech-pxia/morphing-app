"""Compare short field names with user-purpose descriptions on the same OCR cases.

The model sees OCR text, schema labels, and candidate spans. Ground truth is used
only after inference for scoring. This is a development-set probe, not a blind test.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import threading
import time
from collections import Counter
from pathlib import Path

import psutil

from evaluate_diverse import grounded, outcome

ROOT = Path(__file__).resolve().parents[1]
ROWS = json.loads((ROOT / "results" / "diverse_export.json").read_text(encoding="utf-8"))
MEANINGS = json.loads((ROOT / "prefill" / "field_meanings.json").read_text(encoding="utf-8"))
OUT = ROOT / "results" / "structured_eval"


def select(row: dict, field: dict, spans: list[dict], compare_candidates: bool):
    if not spans:
        return None, "noSpan", None
    ranked = spans if compare_candidates else spans[:1]
    for span in ranked:
        value, status = grounded(row, field, span)
        if status != "unmapped":
            return value, status, span
    return None, "unmapped", spans[0]


def run(backend: str, lang: str | None) -> None:
    rows = [row for row in ROWS if lang is None or row["lang"] == lang]
    process = psutil.Process(os.getpid())
    active = True
    peak = 0

    def monitor():
        nonlocal peak
        while active:
            peak = max(peak, process.memory_info().rss)
            time.sleep(.05)

    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    t0 = time.perf_counter()
    if backend == "uie":
        from paddlenlp import Taskflow
        if lang is None:
            raise ValueError("UIE requires --lang")
        model = Taskflow("information_extraction", schema=["placeholder"], model="uie-m-base",
                         schema_lang="zh" if lang == "zh" else "en", device="cpu")
    else:
        from gliner2 import AutoExtractor
        model = AutoExtractor.from_pretrained("fastino/gliner2.5-multi-v1")
    load_s = time.perf_counter() - t0
    details = []
    times = []
    try:
        for row in rows:
            for labels_kind in ("name", "meaning", "combined"):
                labels = {
                    f["id"]: (f["name"] if labels_kind == "name" else
                              MEANINGS[row["id"]][f["id"]] if labels_kind == "meaning" else
                              f"{f['name']}: {MEANINGS[row['id']][f['id']]}")
                    for f in row["fields"]
                }
                t0 = time.perf_counter()
                if backend == "uie":
                    model.set_schema(list(labels.values()))
                    output = model(row["text"])[0]
                    spans = {key: sorted(output.get(label, []), key=lambda s: -s["probability"])
                             for key, label in labels.items()}
                else:
                    entities = model.extract_entities(row["text"], labels, threshold=.5,
                                                      include_confidence=True, include_spans=True)["entities"]
                    spans = {key: sorted(entities.get(key, []), key=lambda s: -s["confidence"])
                             for key in labels}
                times.append(time.perf_counter() - t0)
                for field in row["fields"]:
                    for mode in ("top", "compare"):
                        value, status, span = select(row, field, spans[field["id"]], mode == "compare")
                        result = outcome(field, row["truth"].get(field["id"]), value, status)
                        details.append({"id": row["id"], "field": field["id"], "type": field["type"],
                                        "labels": labels_kind, "mode": mode,
                                        "truth": row["truth"].get(field["id"]), "got": value,
                                        "status": status, "result": result,
                                        "span": span["text"] if span else None,
                                        "score": (span.get("probability", span.get("confidence")) if span else None),
                                        "n_spans": len(spans[field["id"]])})
    finally:
        active = False
        thread.join(timeout=1)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"meaning_{backend}_{lang or 'all'}.json"
    path.write_text(json.dumps({"backend": backend, "lang": lang,
                                "load_s": load_s, "peak_rss_mb": peak / 2**20,
                                "p50_s": statistics.median(times), "details": details},
                               ensure_ascii=False, indent=2), encoding="utf-8")
    print(backend, lang, "docs", len(rows), "peak_mb", round(peak / 2**20),
          "p50", round(statistics.median(times), 3))
    for labels_kind in ("name", "meaning", "combined"):
        for mode in ("top", "compare"):
            count = Counter(d["result"] for d in details if d["labels"] == labels_kind and d["mode"] == mode)
            print(labels_kind, mode, dict(count))
    for d in details:
        if d["labels"] == "combined" and d["mode"] == "compare" and d["result"] not in ("correct", "emptyOk"):
            print("MISS", d["id"], d["field"], d["result"], d["span"], flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("backend", choices=("uie", "gliner"))
    parser.add_argument("--lang", choices=("zh", "en", "fr"))
    args = parser.parse_args()
    run(args.backend, args.lang)
