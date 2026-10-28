"""Score grounded span extraction on the existing pairs2 model-select corpus."""
from __future__ import annotations

import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path

from run_structured import map_span_to_candidate

HERE = Path(__file__).resolve().parents[1] / "results" / "structured_eval"
SOURCE = Path(__file__).resolve().parents[1] / "results" / "prefill_pairs2_export.json"
ROWS = json.loads(SOURCE.read_text(encoding="utf-8"))


def same(field, a, b):
    if a is None or b is None:
        return a is None and b is None
    return abs(float(a) - float(b)) < 0.005 if field == "amount" else a == b


def outcome(field, truth, value):
    if truth is None:
        return "emptyOk" if value is None else "filledNull"
    if value is None:
        return "empty"
    return "correct" if same(field, truth, value) else "wrong"


def score(model):
    path = HERE / f"{model}.jsonl"
    outputs = {x["id"]: x for line in path.read_text(encoding="utf-8").splitlines()
               if (x := json.loads(line))}
    times = sorted(x["elapsed_s"] for x in outputs.values())
    counts = defaultdict(Counter)
    source_status = defaultdict(Counter)
    errors = []
    for row in ROWS:
        output = outputs.get(row["id"])
        if output is None:
            continue
        for field in ("amount", "date"):
            entries = next(x["entries"] for x in row["candidates"] if x["kind"] == field)
            top = output["spans"][field][0] if output["spans"][field] else None
            candidate = map_span_to_candidate(row, field, top) if top else None
            selected = candidate["value"] if candidate else None
            rm = (row["memory"].get(field) or {}).get("value")
            rule = (row["rule"].get(field) or {}).get("value")
            agrees = selected is not None and (
                (rm is not None and same(field, selected, rm)) or
                (rule is not None and same(field, selected, rule))
            )
            guarded = rm if rm is not None else selected if agrees else None
            if row["seq"] >= 2:
                status = "noSpan" if top is None else "mapped" if selected is not None else "unmapped"
                source_status[(field, row["lang"])][status] += 1
                for version, value in (("RM", rm), ("raw", selected), ("guarded", guarded)):
                    result = outcome(field, row["truth"][field], value)
                    counts[(field, row["lang"], version)][result] += 1
                    counts[(field, "all", version)][result] += 1
                    if version == "raw" and result in ("wrong", "filledNull"):
                        errors.append({"id": row["id"], "field": field, "lang": row["lang"],
                                       "variation": row["variation"], "truth": row["truth"][field],
                                       "selected": selected, "span": top["text"] if top else None})
    summary = {"model": model, "rows": len(outputs),
               "p50_s": round(statistics.median(times), 3),
               "p95_s": round(times[math.ceil(0.95 * len(times)) - 1], 3),
               "counts": {"/".join(k): dict(v) for k, v in sorted(counts.items())},
               "sourceStatus": {"/".join(k): dict(v) for k, v in sorted(source_status.items())},
               "rawErrors": errors}
    (HERE / f"{model}-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(model, "rows", len(outputs), "p50", summary["p50_s"], "p95", summary["p95_s"])
    for k, v in sorted(counts.items()):
        if k[1] == "all" or k[2] == "raw":
            print(*k, dict(v))
    for k, v in sorted(source_status.items()):
        print("source", *k, dict(v))


if __name__ == "__main__":
    for model_name in ("gliner2.5-multi", "uie-m-base"):
        score(model_name)
