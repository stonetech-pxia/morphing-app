"""Try an explicit source-evidence gate on UIE's candidate-line selection.

The gate is deliberately generic and conservative: the field name itself must
appear directly before the chosen source on the same or following line. It is
an exploratory local postprocessor, not an app implementation or a semantic
paraphrase model. Only model-selected source positions may be accepted.
"""
from __future__ import annotations

import argparse
import json
import unicodedata
from collections import Counter
from pathlib import Path

from evaluate_heldout import grade, source_candidates

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results" / "structured_eval"


def normalized_with_offsets(text: str) -> tuple[str, list[int]]:
    letters: list[str] = []
    offsets: list[int] = []
    for i, character in enumerate(text):
        for part in unicodedata.normalize("NFKD", character).casefold():
            if part.isalnum():
                letters.append(part)
                offsets.append(i)
    return "".join(letters), offsets


def utf16_to_python(text: str, offset: int) -> int:
    units = 0
    for i, character in enumerate(text):
        if units >= offset:
            return i
        units += 2 if ord(character) > 0xFFFF else 1
    return len(text)


def evidence(row: dict, field: dict, source: dict) -> dict | None:
    """Return the field label and selected source offsets if directly adjacent."""
    text = row["text"]
    normalized, positions = normalized_with_offsets(text)
    target, _ = normalized_with_offsets(field["name"])
    if not target:
        return None
    lines = text.split("\n")
    candidate_start = sum(len(line) + 1 for line in lines[:source["line"]])
    candidate_start += utf16_to_python(lines[source["line"]], source["start"])
    at = 0
    while (at := normalized.find(target, at)) >= 0:
        label_start = positions[at]
        label_end = positions[at + len(target) - 1] + 1
        label_line = text[:label_end].count("\n")
        if 0 <= source["line"] - label_line <= 1 and candidate_start >= label_end:
            between = text[label_end:candidate_start]
            if not any(character.isalnum() for character in between):
                return {"labelStart": label_start, "labelEnd": label_end,
                        "sourceStart": candidate_start, "sourceEnd": candidate_start + len(source["raw"]),
                        "label": text[label_start:label_end], "raw": source["raw"]}
        at += 1
    return None


def selected_source(row: dict, field: dict, detail: dict) -> dict | None:
    got = detail.get("got")
    line = detail.get("selectedLine")
    if got is None or line is None:
        return None
    matches = [source for source in source_candidates(row, field)
               if source["line"] == line and source["values"] == got]
    # If the model's saved result cannot identify exactly one source position,
    # abstain rather than inventing an evidence span.
    return matches[0] if len(matches) == 1 else None


def run(dataset: str) -> None:
    rows = json.loads((ROOT / "results" / f"{dataset}_export.json").read_text(encoding="utf-8"))
    row_by_id = {row["id"]: row for row in rows}
    baseline: list[dict] = []
    gated: list[dict] = []
    for lang in ("zh", "en", "fr"):
        result = json.loads((OUT / f"{dataset}_{lang}.json").read_text(encoding="utf-8"))
        for detail in result["details"]:
            if detail["method"] != "uie_candidates":
                continue
            row = row_by_id[detail["id"]]
            field = next(field for field in row["fields"] if field["id"] == detail["field"])
            source = selected_source(row, field, detail)
            proof = evidence(row, field, source) if source is not None else None
            outcome = grade(field, detail["truth"], source if proof else None)
            baseline.append(detail)
            gated.append({"id": detail["id"], "lang": lang, "field": detail["field"],
                          "truth": detail["truth"], "baseline": detail["result"],
                          "result": outcome, "evidence": proof,
                          "selected": source["raw"] if source else None})
    path = OUT / f"{dataset}_evidence_gate.json"
    path.write_text(json.dumps({"dataset": dataset, "details": gated},
                               ensure_ascii=False, indent=2), encoding="utf-8")
    print(dataset, "baseline", dict(Counter(item["result"] for item in baseline)))
    print(dataset, "gated", dict(Counter(item["result"] for item in gated)))
    print(dataset, "evidence", sum(item["evidence"] is not None for item in gated), "/", len(gated))
    for item in gated:
        if item["result"] not in ("correct", "emptyOk") or item["baseline"] != item["result"]:
            print("CASE", item["id"], item["field"], item["baseline"], "=>", item["result"],
                  item["selected"], item["evidence"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", choices=("heldout_pairs", "heldout_absence_pairs",
                                              "heldout_evidence_pairs"), required=True)
    run(parser.parse_args().dataset)
