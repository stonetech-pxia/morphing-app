"""探索：固定字段优先用现有 Morph 规则，税额缺证据时丢弃模型值。"""
from __future__ import annotations

import json
import re
from pathlib import Path

from score import field_score, load_results, valid_output

ROOT=Path(__file__).resolve().parents[1]
RULES={row["sample_id"]:json.loads(row["output"]) for row in load_results(ROOT/"results"/"morph-rules.jsonl")}
TAX_LINE=re.compile(r"(?im)^\s*(?:tax|tva|税额)\s*[:：]?\s*[-+]?\d")


def stats(path: Path, clean_only: bool = True) -> None:
    counts={name:{"amount":0,"date":0,"fabricated":0,"nulls":0,"valid":0,"merchant":0,"category":0}
            for name in ("raw","guarded")}
    samples=0
    for row in load_results(path):
        if clean_only and (not row["sample_id"].startswith("receipts-") or not row["sample_id"].endswith("-clean")):
            continue
        folder=ROOT/"data"/row["sample_id"]
        schema=json.loads((folder/"schema.json").read_text(encoding="utf-8"))
        truth=json.loads((folder/"truth.json").read_text(encoding="utf-8"))
        ocr=(folder/"ocr.txt").read_text(encoding="utf-8")
        try: raw=json.loads(row["output"])
        except (json.JSONDecodeError,TypeError): raw={}
        guarded=dict(raw)
        rule=RULES[row["sample_id"]]
        for field in ("date","invoiceNo"):
            if field in guarded: guarded[field]=rule.get(field)
        if "tax" in guarded and not TAX_LINE.search(ocr): guarded["tax"]=None
        for name,values in (("raw",raw),("guarded",guarded)):
            out=counts[name]
            out["valid"]+=valid_output(values,schema)
            for field in schema["fields"]:
                key=field["id"]
                actual=values.get(key)
                expected=truth[key]
                if key in ("amount","date","merchant","category"):
                    out[key]+=field_score(expected,actual,field)[0]
                if expected is None:
                    out["nulls"]+=1
                    out["fabricated"]+=actual is not None
        samples+=1
    print(path.name,"scope",("clean receipts" if clean_only else "all"),"samples",samples)
    for name,out in counts.items(): print(name,out)


if __name__=="__main__":
    for filename in ("qwen35-08b-cpu-schema-shared.jsonl","qwen35-2b-cuda-schema-date_parts_tax.jsonl"):
        stats(ROOT/"results"/filename)
    stats(ROOT/"results"/"qwen35-4b-cuda-schema-date_parts_tax.jsonl",clean_only=False)
