"""Pilot: rerank GLiNER2 grounded spans with a small multilingual cross-encoder."""
from __future__ import annotations

import json
import os
import re
import statistics
import time
import threading
from collections import Counter
from pathlib import Path

import psutil
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

RESULTS = Path(__file__).resolve().parents[1] / "results"
STRUCTURED = RESULTS / "structured_eval"
SOURCE = RESULTS / "prefill_pairs2_export.json"
MODEL = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
REVISION = "1427fd652930e4ba29e8149678df786c240d8825"
QUERIES = {
    "zh": {"amount": "这份文件最终需要支付或实际支付的总金额是哪一行？",
           "date": "这份文件的开具日期、交易日期或发生日期是哪一行？"},
    "en": {"amount": "Which line gives the final total amount paid or due?",
           "date": "Which line gives the document issue, transaction, or event date?"},
    "fr": {"amount": "Quelle ligne indique le montant total final payé ou dû ?",
           "date": "Quelle ligne indique la date d'émission, de transaction ou de l'événement ?"},
}


def simple(text: str) -> str:
    return re.sub(r"[^0-9a-z]", "", text.casefold())


def ground(row: dict, field: str, span: dict) -> dict | None:
    raw = simple(span["text"])
    if len(raw) < 3:
        return None
    if field == "amount" and len(re.findall(r"\d+(?:[.,]\d+)*", span["text"])) != 1:
        return None
    if field == "date" and len(re.findall(r"\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}", span["text"])) > 1:
        return None
    line = row["text"][:span["start"]].count("\n")
    entries = next(x["entries"] for x in row["candidates"] if x["kind"] == field)
    found = [c for c in entries if c["line"] == line and len(simple(c["raw"])) >= 3
             and simple(c["raw"]) in raw
             and (field != "amount" or ("-" in c["raw"]) == ("-" in span["text"]))]
    if not found:
        return None
    longest = max(len(simple(c["raw"])) for c in found)
    found = [c for c in found if len(simple(c["raw"])) == longest]
    # The model selected a source span, not a day/month interpretation.
    if len({c["value"] for c in found}) != 1:
        return None
    return found[0]


def passage(row: dict, candidate: dict) -> str:
    lines = row["text"].split("\n")
    i = candidate["line"]
    prev = lines[i - 1] if i and len(lines[i].strip()) < 20 else ""
    return f"{lines[0]} | {prev} {lines[i]}".strip()


def verdict(field: str, truth, got) -> str:
    if truth is None:
        return "emptyOk" if got is None else "filledNull"
    if got is None:
        return "empty"
    return "correct" if (abs(float(truth) - float(got)) < .005 if field == "amount"
                         else truth == got) else "wrong"


def main() -> None:
    rows = json.loads(SOURCE.read_text(encoding="utf-8"))
    spans = {json.loads(line)["id"]: json.loads(line)
             for line in (STRUCTURED / "gliner2.5-multi.jsonl").read_text(encoding="utf-8").splitlines() if line}
    proc = psutil.Process(os.getpid())
    peak = 0
    live = True

    def monitor() -> None:
        nonlocal peak
        while live:
            peak = max(peak, proc.memory_info().rss)
            time.sleep(.05)

    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    torch.set_num_threads(4)
    t0 = time.perf_counter()
    tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL, revision=REVISION).eval()
    load_s = time.perf_counter() - t0
    results = []
    try:
        for row in rows:
            output = spans.get(row["id"])
            if output is None:
                continue
            record = {"id": row["id"], "seq": row["seq"], "lang": row["lang"], "truth": row["truth"],
                      "selected": {}, "raw": {}, "elapsed_s": 0}
            t0 = time.perf_counter()
            for field in ("amount", "date"):
                options = []
                for span in output["spans"][field][:5]:
                    candidate = ground(row, field, span)
                    if candidate and not any(c["id"] == candidate["id"] for c in options):
                        options.append(candidate)
                direct = ground(row, field, output["spans"][field][0]) if output["spans"][field] else None
                record["raw"][field] = direct["value"] if direct else None
                if not options:
                    record["selected"][field] = None
                    continue
                pairs = [(QUERIES[row["lang"]][field], passage(row, c)) for c in options]
                encoded = tokenizer(pairs, padding=True, truncation=True, max_length=256, return_tensors="pt")
                with torch.no_grad():
                    logits = model(**encoded).logits.squeeze(-1).tolist()
                if isinstance(logits, float):
                    logits = [logits]
                best = max(range(len(options)), key=lambda i: logits[i])
                record["selected"][field] = options[best]["value"]
                record.setdefault("scores", {})[field] = [
                    {"value": c["value"], "score": round(score, 4), "line": c["line"]}
                    for c, score in zip(options, logits)
                ]
            record["elapsed_s"] = time.perf_counter() - t0
            results.append(record)
            if len(results) % 20 == 0:
                print(f"{len(results)}/{len(rows)}", flush=True)
    finally:
        live = False
        thread.join(timeout=1)
    STRUCTURED.mkdir(parents=True, exist_ok=True)
    (STRUCTURED / "rerank_pilot.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in results) + "\n", encoding="utf-8")
    for field in ("amount", "date"):
        for name in ("raw", "selected"):
            counts = Counter(verdict(field, r["truth"][field], r[name][field])
                             for r in results if r["seq"] >= 2)
            print(field, name, dict(counts))
    elapsed = sorted(r["elapsed_s"] for r in results)
    print(json.dumps({"model": MODEL, "revision": REVISION,
                      "load_s": round(load_s, 2), "peak_rss_mb": round(peak / 2**20),
                      "p50_s": round(statistics.median(elapsed), 3),
                      "p95_s": round(elapsed[int(.95 * (len(elapsed) - 1))], 3)}, indent=2))


if __name__ == "__main__":
    main()
