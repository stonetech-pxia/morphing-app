"""任务 124 ①：独立的虚构样本上校准并测试「无法判断」（Qwen3-Embedding GGUF，llama.cpp CPU）。

holdout/cases.jsonl 按 split 分成校准集和测试集（同一商家 / 版式的在同一边）。空白和乱码先由 App 里的
textReadability 拒判（ts_features.ts 调用同一份 TS 代码），不交给模型。其余的按维度编码查询，和同语言的
候选说明比余弦相似度；在校准集上定 min_score / min_margin，只在测试集上报成绩。原始分数写到忽略的
results/classification/。喂给模型的只有识别文字，不含文件名或答案。

从 tests/local-model-eval/ 运行：
  MORPH_LLAMA_SERVER_BIN=/abs/llama-server python classification/evaluate_holdout.py --model q8
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

from calibrate import Thresholds, by, calibrate, closed_set, tally
from evaluate import LANG_INDEX, choices
from llama_embed import LlamaEmbedder, rank

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parents[1]
FILES = {"q4": "cls-qwen3-embedding-06b-q4/Qwen3-Embedding-0.6B-Q4_K_M.gguf",
         "q8": "cls-qwen3-embedding-06b-q8/Qwen3-Embedding-0.6B-Q8_0.gguf"}
FACETS = ("kind", "topic")


def load_cases(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def ts_features(path: Path) -> dict[str, dict]:
    """用 App 的 TS 代码算可读性和规则命中（需要仓库根目录装好 node_modules）。"""
    npx = shutil.which("npx") or "npx"
    out = subprocess.run([npx, "tsx", str(HERE / "ts_features.ts"), str(path)], cwd=REPO,
                         check=True, capture_output=True, text=True, encoding="utf-8").stdout
    return {row["id"]: row for row in map(json.loads, out.splitlines())}


def query(facet: str, text: str) -> str:
    # 和 evaluate_embedding_gguf.py 同一条英文任务指令，桌面成绩才可比。
    task = f"Given OCR text, retrieve the {facet} category that best describes it"
    return f"Instruct: {task}\nQuery: {text}"


def score_rows(cases: list[dict], features: dict[str, dict], embedder: LlamaEmbedder) -> list[dict]:
    candidates = {}
    for lang in LANG_INDEX:
        for facet in FACETS:
            options = choices(facet, lang)
            vectors = embedder.embed([sentence for _, sentence in options])
            candidates[(lang, facet)] = [(cid, vector) for (cid, _), vector in zip(options, vectors)]
    rows = []
    for case in cases:
        readability = features[case["id"]]["readability"]
        for facet in FACETS:
            row = {"id": case["id"], "lang": case["lang"], "split": case["split"], "subset": case["subset"],
                   "facet": facet, "truth": case[facet], "readability": readability,
                   "accept": [] if case[facet] == "none" else [case[facet]],
                   "code_reject": readability != "readable"}
            if row["code_reject"]:
                row.update(top_id=None, top=float("-inf"), margin=0.0, ranking=[])
            else:
                vector = embedder.embed([query(facet, case["text"])])[0]
                top_id, top, margin, ranking = rank(vector, candidates[(case["lang"], facet)])
                row.update(top_id=top_id, top=top, margin=margin, ranking=ranking[:3])
            rows.append(row)
    return rows


def table(title: str, groups: dict[str, list[dict]], th: Thresholds) -> list[str]:
    lines = [f"\n{title}", "| 分组 | 条数 | 正确 | 误分 | 其中范围外给了类别 | 拒判 | 误拒判 | 错误率（给出的里） |",
             "|---|---|---|---|---|---|---|---|"]
    for name, rows in groups.items():
        c = tally(rows, th)
        lines.append(f"| {name} | {c['total']} | {c['correct']} | {c['wrong'] + c['wrong_accept']} | "
                     f"{c['wrong_accept']} | {c['reject_ok']} | {c['false_reject']} | {c['error_rate']:.1%} |")
    return lines


def report(rows: list[dict], max_error_rate: float) -> tuple[dict, str]:
    summary, lines = {}, []
    for facet in FACETS:
        calib = [r for r in rows if r["facet"] == facet and r["split"] == "calib"]
        test = [r for r in rows if r["facet"] == facet and r["split"] == "test"]
        th = calibrate(calib, max_error_rate)
        summary[facet] = {"thresholds": {"min_score": th.min_score, "min_margin": th.min_margin},
                          "calib": tally(calib, th), "test": tally(test, th),
                          "test_by_lang": {k: tally(v, th) for k, v in by(test, "lang").items()},
                          "test_by_subset": {k: tally(v, th) for k, v in by(test, "subset").items()},
                          "test_closed_set": closed_set(test)}
        lines.append(f"\n## {facet}：校准集上定的阈值 min_score={th.min_score:.4f}、min_margin={th.min_margin:.4f}"
                     f"（目标：给出的里错的不超过 {max_error_rate:.0%}）")
        lines += table("测试集，按语言", {**by(test, "lang"), "合计": test}, th)
        lines += table("测试集，按样本类型", by(test, "subset"), th)
        closed = summary[facet]["test_closed_set"]
        lines.append(f"\n不设阈值、强制选最高分（旧口径）：测试集正确 {closed['correct']}/{closed['total']}，"
                     f"误分 {closed['wrong'] + closed['wrong_accept']}")
    return summary, "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=tuple(FILES), required=True)
    parser.add_argument("--cases", type=Path, default=HERE / "holdout" / "cases.jsonl")
    parser.add_argument("--max-error-rate", type=float, default=.05)
    parser.add_argument("--port", type=int, default=8097)
    parser.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    parser.add_argument("--server-bin", type=Path)
    args = parser.parse_args()
    model = (ROOT / "models" / FILES[args.model]).resolve()
    if not model.is_file():
        raise FileNotFoundError(f"{model}（先运行 classification/download.py qwen3-embedding-{args.model}）")
    configured = args.server_bin or os.environ.get("MORPH_LLAMA_SERVER_BIN") or shutil.which("llama-server")
    if not configured:
        raise FileNotFoundError("Set --server-bin or MORPH_LLAMA_SERVER_BIN")
    cases = load_cases(args.cases)
    features = ts_features(args.cases)
    output = ROOT / "results" / "classification"
    with LlamaEmbedder(Path(configured).expanduser().resolve(), model, args.port, args.threads,
                       output / f"holdout-{model.stem}.log") as embedder:
        rows = score_rows(cases, features, embedder)
    summary, text = report(rows, args.max_error_rate)
    stem = f"holdout-{model.stem}"
    (output / f"{stem}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
                                         encoding="utf-8")
    (output / f"{stem}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
