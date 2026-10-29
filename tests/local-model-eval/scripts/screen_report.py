"""把干净小票的资格筛查结果输出为 Markdown 表格。"""
from __future__ import annotations

import statistics
from pathlib import Path

from score import load_results, score_rows

ROOT=Path(__file__).resolve().parents[1]
print("| 模型 | 模式/提示词 | 样本 | 金额 | 日期 | 编造 | JSON 合法 | 中位耗时 | 生成速度 | 峰值工作集 |")
print("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
for path in sorted((ROOT/"results").glob("*-cpu-*.jsonl")):
    if "pilot" in path.name or "summary" in path.name: continue
    raw=[r for r in load_results(path) if r["sample_id"].startswith("receipts-") and r["sample_id"].endswith("-clean")]
    if not raw: continue
    rows,_=score_rows(path)
    rows=[r for r in rows if r["category"]=="receipts" and r["difficulty"]=="clean"]
    amount=[r for r in rows if r["field"]=="amount"]
    date=[r for r in rows if r["field"]=="date"]
    absent=[r for r in rows if r["null_truth"]]
    legal=sum(r["json_legal"] for r in amount)/len(amount)
    speeds=[r["timings"]["predicted_per_second"] for r in raw if r.get("timings") and r["timings"].get("predicted_per_second")]
    seconds=[r["elapsed_s"] for r in raw if r.get("elapsed_s") is not None]
    peak=max((r.get("rss_peak_bytes") or 0 for r in raw),default=0)/1e9
    model=raw[0]["model"]
    mode=f'{raw[0]["mode"]}/{raw[0].get("prompt","shared")}'
    print(f'| {model} | {mode} | {len(raw)} | {sum(r["correct"] for r in amount)}/{len(amount)} | '
          f'{sum(r["correct"] for r in date)}/{len(date)} | {sum(r["fabricated"] for r in absent)}/{len(absent)} | '
          f'{legal:.1%} | {statistics.median(seconds):.1f} s | '
          f'{statistics.median(speeds):.1f} tok/s | {peak:.2f} GB |')
