"""按字段、语言、类别、难度评分；原始输出始终保留。"""
from __future__ import annotations

import argparse
import csv
import difflib
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def norm(x: str) -> str:
    return re.sub(r"\s+","",unicodedata.normalize("NFKC",x)).casefold()


def field_score(expected, actual, field: dict) -> tuple[bool,float]:
    if expected is None: return actual is None,float(actual is None)
    if actual is None: return False,0.0
    typ=field["type"]
    if typ in ("money","number"):
        ok=isinstance(actual,(int,float)) and not isinstance(actual,bool) and abs(actual-expected)<=0.0100001
        return bool(ok),float(ok)
    if typ=="rating":
        ok=type(actual) is int and actual==expected
        return ok,float(ok)
    if typ=="checkbox":
        ok=type(actual) is bool and actual==expected
        return ok,float(ok)
    if not isinstance(actual,str): return False,0.0
    a,b=norm(str(expected)),norm(actual)
    return a==b,difflib.SequenceMatcher(None,a,b).ratio()


def valid_output(output: object, schema: dict) -> bool:
    if not isinstance(output,dict): return False
    fields=schema["fields"]
    if set(output)!={f["id"] for f in fields}: return False
    for f in fields:
        v=output[f["id"]]
        if v is None: continue
        t=f["type"]
        if t in ("money","number") and (not isinstance(v,(int,float)) or isinstance(v,bool)): return False
        if t=="rating" and (type(v) is not int or not 1<=v<=5): return False
        if t=="checkbox" and type(v) is not bool: return False
        if t in ("text","note","date","choice") and not isinstance(v,str): return False
        if t=="choice" and v not in [o["id"] for o in f["options"]]: return False
    return True


def no_duplicate_keys(pairs: list[tuple[str, object]]) -> dict:
    result={}
    for key,value in pairs:
        if key in result: raise ValueError(f"duplicate JSON key: {key}")
        result[key]=value
    return result


def load_results(path: Path) -> list[dict]:
    latest={}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line:
            row=json.loads(line)
            latest[row["sample_id"]]=row
    return list(latest.values())


def score_rows(path: Path) -> tuple[list[dict],list[dict]]:
    rows=[]; summary=[]
    for raw in load_results(path):
        folder=ROOT/"data"/raw["sample_id"]
        schema=json.loads((folder/"schema.json").read_text(encoding="utf-8"))
        truth=json.loads((folder/"truth.json").read_text(encoding="utf-8"))
        meta=json.loads((folder/"meta.json").read_text(encoding="utf-8"))
        if raw["mode"]=="summary":
            points=json.loads((folder/"summary_points.json").read_text(encoding="utf-8"))
            output=raw.get("output") or ""
            must=[norm(p) in norm(output) for p in points["must"]]
            forbidden=[norm(p) in norm(output) for p in points["must_not"]]
            summary.append({**meta,"model":raw["model"],"coverage":sum(must)/len(must),"invented":sum(forbidden),"output":output})
            continue
        try: parsed=json.loads(raw.get("output") or "",object_pairs_hook=no_duplicate_keys)
        except (json.JSONDecodeError,TypeError,ValueError): parsed=None
        legal=valid_output(parsed,schema) if raw["mode"]!="rules" else isinstance(parsed,dict)
        for f in schema["fields"]:
            if raw["mode"]=="rules" and f["id"] not in ("amount","date","invoiceNo"): continue
            expected=truth[f["id"]]
            actual=parsed.get(f["id"]) if isinstance(parsed,dict) else None
            correct,fuzzy=field_score(expected,actual,f)
            rows.append({**meta,"model":raw["model"],"mode":raw["mode"],"backend":raw.get("backend",""),"field":f["id"],"field_type":f["type"],
                         "expected":expected,"actual":actual,"correct":correct,"fuzzy":fuzzy,"null_truth":expected is None,
                         "fabricated":expected is None and actual is not None,"omitted":expected is not None and actual is None,
                         "json_legal":legal,"elapsed_s":raw.get("elapsed_s"),"rss_peak_bytes":raw.get("rss_peak_bytes")})
    return rows,summary


def aggregate(rows: list[dict], keys: tuple[str,...]) -> list[dict]:
    groups=defaultdict(list)
    for row in rows: groups[tuple(row[k] for k in keys)].append(row)
    out=[]
    for group,items in sorted(groups.items()):
        missing=[x for x in items if x["null_truth"]]
        present=[x for x in items if not x["null_truth"]]
        out.append({**dict(zip(keys,group)),"fields":len(items),"accuracy":sum(x["correct"] for x in items)/len(items),
                    "non_null_accuracy":sum(x["correct"] for x in present)/len(present) if present else None,
                    "fuzzy":sum(x["fuzzy"] for x in present)/len(present) if present else None,
                    "fabrication_rate":sum(x["fabricated"] for x in missing)/len(missing) if missing else None,
                    "omission_rate":sum(x["omitted"] for x in present)/len(present) if present else None,
                    "json_legal_rate":sum(x["json_legal"] for x in items)/len(items),
                    "choice_accuracy":(sum(x["correct"] for x in items if x["field_type"]=="choice" and not x["null_truth"])/sum(x["field_type"]=="choice" and not x["null_truth"] for x in items)) if any(x["field_type"]=="choice" and not x["null_truth"] for x in items) else None})
    return out


if __name__=="__main__":
    p=argparse.ArgumentParser(); p.add_argument("files",nargs="*",type=Path)
    a=p.parse_args(); files=a.files or sorted((ROOT/"results").glob("*.jsonl"))
    all_rows=[]; summaries=[]
    for file in files:
        rows,summary=score_rows(file); all_rows+=rows; summaries+=summary
    score_name=files[0].stem if len(files)==1 else "combined"
    out=ROOT/"results"/"scores"/score_name; out.mkdir(parents=True,exist_ok=True)
    (out/"fields.jsonl").write_text("".join(json.dumps(row,ensure_ascii=False)+"\n" for row in all_rows),encoding="utf-8")
    (out/"summaries.jsonl").write_text("".join(json.dumps(row,ensure_ascii=False)+"\n" for row in summaries),encoding="utf-8")
    for keys,name in [(('model','mode','backend'),'overall'),(('model','mode','backend','language','category','difficulty'),'breakdown'),(('model','mode','backend','language','difficulty'),'language_difficulty')]:
        table=aggregate(all_rows,keys)
        if table:
            with (out/(name+".csv")).open("w",encoding="utf-8-sig",newline="") as stream:
                writer=csv.DictWriter(stream,fieldnames=table[0].keys());writer.writeheader();writer.writerows(table)
    print("scored",len(all_rows),"fields and",len(summaries),"summaries")
