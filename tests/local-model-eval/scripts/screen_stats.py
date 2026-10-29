"""打印干净小票的资格门槛结果（只有完整 50 份才可作结论）。"""
from __future__ import annotations

from pathlib import Path
from score import score_rows

ROOT=Path(__file__).resolve().parents[1]
for path in sorted((ROOT/"results").glob("*-cpu-*.jsonl")):
    if "pilot" in path.name or "strict" in path.name: continue
    rows,_=score_rows(path)
    rows=[r for r in rows if r["category"]=="receipts" and r["difficulty"]=="clean"]
    if not rows: continue
    samples={r["id"] for r in rows}
    amount=[r for r in rows if r["field"]=="amount"]
    date=[r for r in rows if r["field"]=="date"]
    absent=[r for r in rows if r["null_truth"]]
    fmt=sum(r["json_legal"] for r in amount)/len(amount) if amount else 0
    print(path.name,"samples",len(samples),"amount",sum(r["correct"] for r in amount),"/",len(amount),
          "date",sum(r["correct"] for r in date),"/",len(date),
          "fabrication",sum(r["fabricated"] for r in absent),"/",len(absent),
          "JSON",round(fmt,3),"peak_GB",round(max(r["rss_peak_bytes"] or 0 for r in rows)/1e9,3))
