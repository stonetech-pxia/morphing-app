"""Small diverse-document pilot. Synthetic inputs; never use as deployment accuracy."""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import threading
import time
from collections import Counter
from pathlib import Path

import psutil

RESULTS = Path(__file__).resolve().parents[1] / "results"
SOURCE = RESULTS / "diverse_export.json"
ROWS = json.loads(SOURCE.read_text(encoding="utf-8"))


def norm(text: str) -> str:
    return re.sub(r"[\W_]", "", str(text).casefold())


def grounded(row: dict, field: dict, span: dict) -> tuple[object, str]:
    typ = field["type"]
    truth = row["truth"].get(field["id"])
    raw = span["text"].strip()
    if typ == "text":
        return raw, "mapped"
    if typ == "number":
        digits = re.findall(r"\d+(?:[.,]\d+)?", raw)
        return (float(digits[0].replace(",", ".")), "mapped") if len(digits) == 1 else (None, "unmapped")
    kind = "date" if typ == "date" else "amount"
    line = row["text"][:max(0, span.get("start", 0))].count("\n")
    candidates = [c for c in row["candidates"] if c["kind"] == kind and c["line"] == line
                  and len(norm(c["raw"])) >= 3 and norm(c["raw"]) in norm(raw)]
    if not candidates:
        return None, "unmapped"
    longest = max(len(norm(c["raw"])) for c in candidates)
    candidates = [c for c in candidates if len(norm(c["raw"])) == longest]
    values = {c["value"] for c in candidates}
    if len(values) != 1:
        return (truth if truth in values else None), "dateOrderAmbiguous"
    return candidates[0]["value"], "mapped"


def outcome(field: dict, truth, got, status: str) -> str:
    if status == "dateOrderAmbiguous":
        return "ambiguousSource" if got is not None else "wrongSource"
    if truth is None:
        return "emptyOk" if got is None else "filledNull"
    if got is None:
        return "empty"
    if field["type"] in ("money", "number"):
        return "correct" if abs(float(truth) - float(got)) < .005 else "wrong"
    return "correct" if norm(truth) == norm(got) else "wrong"


def main(backend: str, lang: str | None) -> None:
    rows = [row for row in ROWS if lang is None or row["lang"] == lang]
    proc = psutil.Process(os.getpid())
    active = True
    peak = 0

    def monitor():
        nonlocal peak
        while active:
            peak = max(peak, proc.memory_info().rss)
            time.sleep(.05)

    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    t0 = time.perf_counter()
    if backend == "gliner":
        from gliner2 import AutoExtractor
        model = AutoExtractor.from_pretrained("fastino/gliner2.5-multi-v1")
    else:
        from paddlenlp import Taskflow
        if lang is None:
            raise ValueError("UIE requires --lang")
        model = Taskflow("information_extraction", schema=["placeholder"], model="uie-m-base",
                         schema_lang="zh" if lang == "zh" else "en", device="cpu")
    load_s = time.perf_counter() - t0
    counts = Counter()
    details = []
    times = []
    try:
        for row in rows:
            labels = {f["id"]: f["name"] for f in row["fields"]}
            t0 = time.perf_counter()
            if backend == "gliner":
                entities = model.extract_entities(row["text"], labels, threshold=.5,
                                                  include_confidence=True, include_spans=True)["entities"]
                spans = {key: sorted(entities.get(key, []), key=lambda x: -x["confidence"])
                         for key in labels}
            else:
                model.set_schema(list(labels.values()))
                output = model(row["text"])[0]
                spans = {key: sorted(output.get(label, []), key=lambda x: -x["probability"])
                         for key, label in labels.items()}
            times.append(time.perf_counter() - t0)
            for field in row["fields"]:
                key = field["id"]
                top = spans[key][0] if spans[key] else None
                got, status = grounded(row, field, top) if top else (None, "noSpan")
                truth = row["truth"].get(key)
                result = outcome(field, truth, got, status)
                counts[(field["type"], result)] += 1
                details.append({"id": row["id"], "field": key, "type": field["type"],
                                "truth": truth, "got": got, "status": status,
                                "outcome": result, "span": top["text"] if top else None})
    finally:
        active = False
        thread.join(timeout=1)
    path = RESULTS / f"diverse_{backend}_{lang or 'all'}.json"
    path.write_text(json.dumps({"backend": backend, "lang": lang, "load_s": load_s,
                                "peak_rss_mb": round(peak / 2**20),
                                "p50_s": statistics.median(times),
                                "p95_s": sorted(times)[int(.95 * (len(times)-1))],
                                "details": details}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(backend, lang, "docs", len(rows), "load", round(load_s, 2),
          "peak_mb", round(peak / 2**20), "p50", round(statistics.median(times), 3))
    for (typ, result), count in sorted(counts.items()):
        print(typ, result, count)
    for detail in details:
        if detail["outcome"] in ("wrong", "filledNull", "wrongSource"):
            print("MISS", detail)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("backend", choices=("gliner", "uie"))
    parser.add_argument("--lang", choices=("zh", "en", "fr"))
    args = parser.parse_args()
    main(args.backend, args.lang)
