"""Run the same pairs2 OCR corpus through span-based information extractors.

The data, field truth, candidate list, and outcome definition come from the
existing model-select export. This script does not read truth until scoring.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import threading
import time
from pathlib import Path

import psutil

HERE = Path(__file__).resolve().parents[1] / "results" / "structured_eval"
SOURCE = Path(__file__).resolve().parents[1] / "results" / "prefill_pairs2_export.json"
ROWS = json.loads(SOURCE.read_text(encoding="utf-8"))

UIE_LABELS = {
    "zh": ("实付金额", "日期"),
    "en": ("Total paid", "Date"),
    "fr": ("Montant total", "Date"),
}
GLINER_LABELS = {
    "amount": "final total amount paid or due",
    "date": "document issue or purchase date",
}


def simplify(s: str) -> str:
    return re.sub(r"[^0-9a-z]", "", s.casefold())


def map_span_to_candidate(row: dict, field: str, span: dict) -> dict | None:
    """Ground an extracted source span in the pre-existing candidates."""
    if field == "amount":
        # A span containing a quantity and a price, or two prices, does not
        # identify one unambiguous value. The same applies to a missing sign.
        numbers = re.findall(r"\d+(?:[.,]\d+)*", span["text"])
        if len(numbers) != 1:
            return None
    else:
        dates = re.findall(r"\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}", span["text"])
        if len(dates) > 1:
            return None
    raw = simplify(span["text"])
    if len(raw) < 3:
        return None
    start = span.get("start")
    if start is None:
        start = row["text"].find(span["text"])
    line = row["text"][:max(0, start)].count("\n") if start >= 0 else None
    entries = next(x["entries"] for x in row["candidates"] if x["kind"] == field)
    matches = []
    for candidate in entries:
        if field == "amount" and ("-" in candidate["raw"]) != ("-" in span["text"]):
            continue
        token = simplify(candidate["raw"])
        if len(token) < 3 or token not in raw:
            continue
        distance = abs(candidate["line"] - line) if line is not None else 0
        matches.append((distance, -len(token), candidate))
    if not matches:
        return None
    rank = min((distance, length) for distance, length, _ in matches)
    tied = [candidate for distance, length, candidate in matches
            if (distance, length) == rank]
    # A source span can be correct while its numeric day/month order is unknown.
    if field == "date" and len({candidate["value"] for candidate in tied}) > 1:
        return None
    return tied[0]


def uie_spans(model, row: dict) -> dict[str, list[dict]]:
    labels = UIE_LABELS[row["lang"]]
    model.set_schema(list(labels))
    output = model(row["text"])[0]
    return {
        field: sorted(
            [
                {"text": x["text"], "start": x["start"], "end": x["end"],
                 "confidence": x["probability"]}
                for x in output.get(label, [])
            ],
            key=lambda x: -x["confidence"],
        )
        for field, label in zip(("amount", "date"), labels)
    }


def gliner_spans(model, row: dict) -> dict[str, list[dict]]:
    output = model.extract_entities(
        row["text"], GLINER_LABELS, threshold=0.5,
        include_confidence=True, include_spans=True,
    )["entities"]
    return {field: sorted(output.get(field, []), key=lambda x: -x["confidence"])
            for field in ("amount", "date")}


def run(backend: str, lang: str | None = None) -> None:
    HERE.mkdir(parents=True, exist_ok=True)
    process = psutil.Process(os.getpid())
    peak = {"rss": 0}
    active = threading.Event()
    active.set()

    def monitor() -> None:
        while active.is_set():
            peak["rss"] = max(peak["rss"], process.memory_info().rss)
            time.sleep(0.05)

    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    load_start = time.perf_counter()
    if backend == "gliner2.5-multi":
        from gliner2 import AutoExtractor
        model = AutoExtractor.from_pretrained("fastino/gliner2.5-multi-v1")
        extract = gliner_spans
    elif backend == "uie-m-base":
        from paddlenlp import Taskflow
        if lang is None:
            raise ValueError("UIE requires --lang so Chinese can use its native schema syntax")
        schema_lang = "zh" if lang == "zh" else "en"
        model = Taskflow("information_extraction", schema=list(UIE_LABELS[lang]),
                         model="uie-m-base", schema_lang=schema_lang, device="cpu")
        extract = uie_spans
    else:
        raise ValueError(backend)
    load_s = time.perf_counter() - load_start
    out_path = HERE / f"{backend}.jsonl"
    completed = {json.loads(line)["id"] for line in out_path.read_text(encoding="utf-8").splitlines() if line} if out_path.exists() else set()
    try:
        with out_path.open("a", encoding="utf-8") as stream:
            for index, row in enumerate(ROWS):
                if row["id"] in completed or (lang is not None and row["lang"] != lang):
                    continue
                t0 = time.perf_counter()
                spans = extract(model, row)
                elapsed = time.perf_counter() - t0
                selected = {}
                for field in ("amount", "date"):
                    # Use the model's highest-scored span. Mapping is only a safety
                    # check, not a second chance to choose a lower-ranked span.
                    top = spans[field][0] if spans[field] else None
                    candidate = map_span_to_candidate(row, field, top) if top else None
                    selected[field] = candidate["id"] if candidate else "none"
                record = {"id": row["id"], "model": backend, "selected": selected,
                          "spans": spans, "elapsed_s": elapsed}
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
                stream.flush()
                if (index + 1) % 20 == 0:
                    print(f"{backend} {lang or 'all'} {index + 1}/{len(ROWS)}", flush=True)
        print(json.dumps({"model": backend, "lang": lang, "load_s": load_s,
                          "peak_rss_bytes": peak["rss"], "rows": sum(x["lang"] == lang for x in ROWS) if lang else len(ROWS)},
                         ensure_ascii=False), flush=True)
    finally:
        active.clear()
        thread.join(timeout=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("backend", choices=("gliner2.5-multi", "uie-m-base"))
    parser.add_argument("--lang", choices=("zh", "en", "fr"))
    args = parser.parse_args()
    run(args.backend, args.lang)
