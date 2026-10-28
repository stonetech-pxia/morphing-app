"""任务 124 ②：新用户没有历史时，把文件对上用户自己的表、快捷操作或按内容的内设快捷操作，或者都不推荐。

match/profiles.json 是虚构的用户配置（表用 CollectionSchema 的格式，快捷操作只有名字，和真实配置一样）；
match/presets.json 由 export_presets.ts 从 workflows/presets.ts 导出；match/docs.jsonl 是文件文字和每个用户
可接受的推荐（空 = 不该推荐）。每对（文件, 用户）是一次判断。快捷操作先按文件类型过滤（代码做）。

两种打分，阈值都在校准集上定、只在测试集上报：
  --backend baseline   不用模型：关键词重合（表名、字段名、选项、快捷操作名）+ text-rules 命中对上金额 / 日期 / 电话字段
  --backend embedding  Qwen3-Embedding GGUF（llama.cpp CPU），比较文件文字和候选说明的余弦相似度

从 tests/local-model-eval/ 运行：
  python classification/evaluate_match.py --backend baseline
  MORPH_LLAMA_SERVER_BIN=/abs/llama-server python classification/evaluate_match.py --backend embedding --model q8
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from pathlib import Path

from calibrate import Thresholds, by, calibrate, closed_set, tally
from evaluate_holdout import FILES, ROOT, ts_features
from llama_embed import LlamaEmbedder, rank

HERE = Path(__file__).resolve().parent
MATCH = HERE / "match"

# 字段名里表示电话、邮箱的词（通用的写法，不是照着测试样本挑的）。
CONTACT_WORDS = re.compile(r"phone|tel|mobile|e-?mail|courriel|mail|téléphone|portable|电话|手机|邮箱|联系", re.I)
STOP = {"the", "and", "for", "with", "your", "from", "les", "des", "une", "pour", "avec", "dans", "sur", "aux",
        "par", "est", "vos", "votre", "this", "that", "are", "you", "not", "all", "one", "new"}


def load() -> tuple[list[dict], list[dict], list[dict]]:
    profiles = json.loads((MATCH / "profiles.json").read_text(encoding="utf-8"))
    presets = json.loads((MATCH / "presets.json").read_text(encoding="utf-8"))
    docs = [json.loads(line) for line in (MATCH / "docs.jsonl").read_text(encoding="utf-8").splitlines() if line]
    return profiles, presets, docs


def candidates(profile: dict, presets: list[dict], file: str) -> list[dict]:
    """这个用户、这种文件能推荐的：全部的表；能接这种文件的快捷操作和内设的。"""
    kind = "image" if file == "screenshot" else file
    lang = profile["locale"]
    out = []
    for c in profile["collections"]:
        words = [c["name"]] + [f["name"] for f in c["fields"]] + \
            [o["label"] for f in c["fields"] for o in f.get("options", [])]
        text = f"{c['name']}: " + ", ".join(f["name"] for f in c["fields"])
        out.append({"id": f"collection:{c['id']}", "text": text, "words": words, "fields": c["fields"]})
    for w in profile["workflows"]:
        if kind in w["accepts"]:
            out.append({"id": f"workflow:{w['id']}", "text": w["name"], "words": [w["name"]], "fields": []})
    for p in presets:
        if kind in p["accepts"]:
            out.append({"id": f"preset:{p['id']}", "text": f"{p['name'][lang]}. {p['description'][lang]}",
                        "words": [p["name"][lang]], "fields": []})
    return out


def tokens(text: str) -> set[str]:
    """英法文：3 个字母以上的词（小写）；中文：相邻两个汉字。"""
    text = text.lower()
    out = {w for w in re.findall(r"[a-zà-ÿœæç]{3,}", text) if w not in STOP}
    for run in re.findall(r"[一-鿿]+", text):
        out.update(run[i:i + 2] for i in range(len(run) - 1))
        if len(run) == 1:
            out.add(run)
    return out


def baseline_score(doc_tokens: set[str], rules: dict, cand: dict) -> float:
    words = set().union(*(tokens(w) for w in cand["words"]))
    score = float(len(words & doc_tokens))
    types = {f["type"] for f in cand["fields"]}
    if rules["amount"] and "money" in types:
        score += 1
    if rules["date"] and "date" in types:
        score += 1
    if (rules["phone"] or rules["email"]) and any(CONTACT_WORDS.search(f["name"]) for f in cand["fields"]):
        score += 1
    return score


def rows_for(profiles, presets, docs, score_fn) -> list[dict]:
    rows = []
    for doc in docs:
        for profile in profiles:
            cands = candidates(profile, presets, doc["file"])
            top_id, top, margin, ranking = score_fn(doc, profile, cands)
            rows.append({"doc": doc["id"], "lang": doc["lang"], "profile": profile["id"],
                         "locale": profile["locale"], "split": doc["split"], "file": doc["file"],
                         "accept": doc["accept"][profile["id"]], "top_id": top_id, "top": top,
                         "margin": margin, "ranking": ranking[:3]})
    return rows


def baseline_rows(profiles, presets, docs) -> list[dict]:
    features = ts_features(MATCH / "docs.jsonl")

    def score(doc, _profile, cands):
        doc_tokens = tokens(doc["text"])
        rules = features[doc["id"]]["rules"]
        scores = sorted(((baseline_score(doc_tokens, rules, c), c["id"]) for c in cands), reverse=True)
        if not scores or scores[0][0] <= 0:
            return None, 0.0, 0.0, []
        margin = scores[0][0] - scores[1][0] if len(scores) > 1 else float("inf")
        return scores[0][1], scores[0][0], margin, [(cid, s) for s, cid in scores]

    return rows_for(profiles, presets, docs, score)


def embedding_rows(profiles, presets, docs, embedder: LlamaEmbedder) -> list[dict]:
    task = "Given the OCR text of a file the user just scanned or opened, retrieve the user's table or shortcut this file belongs to"
    queries = {doc["id"]: embedder.embed([f"Instruct: {task}\nQuery: {doc['text']}"])[0] for doc in docs}
    cache: dict[str, list[float]] = {}

    def vector(text: str) -> list[float]:
        if text not in cache:
            cache[text] = embedder.embed([text])[0]
        return cache[text]

    def score(doc, _profile, cands):
        return rank(queries[doc["id"]], [(c["id"], vector(c["text"])) for c in cands])

    return rows_for(profiles, presets, docs, score)


NAMES = {"correct": "推荐对了", "wrong": "推荐错了", "false_reject": "该推荐没推荐",
         "wrong_accept": "不该推荐却推荐", "reject_ok": "正确地不推荐"}


def report(rows: list[dict], max_error_rate: float) -> tuple[dict, str]:
    calib = [r for r in rows if r["split"] == "calib"]
    test = [r for r in rows if r["split"] == "test"]
    th = calibrate(calib, max_error_rate)
    summary = {"thresholds": {"min_score": th.min_score, "min_margin": th.min_margin},
               "calib": tally(calib, th), "test": tally(test, th),
               "test_by_lang": {k: tally(v, th) for k, v in by(test, "lang").items()},
               "test_by_locale": {k: tally(v, th) for k, v in by(test, "locale").items()},
               "test_by_file": {k: tally(v, th) for k, v in by(test, "file").items()},
               "test_closed_set": closed_set(test)}
    head = "| 分组 | 对数 | " + " | ".join(NAMES[k] for k in NAMES) + " | 错误推荐率 |"
    lines = [f"校准集上定的阈值：min_score={th.min_score}、min_margin={th.min_margin}"
             f"（目标：推荐里错的不超过 {max_error_rate:.0%}）", "", head, "|---" * (len(NAMES) + 3) + "|"]
    for title, group in [("测试集合计", test), *[(f"文件语言 {k}", v) for k, v in by(test, "lang").items()],
                         *[(f"用户语言 {k}", v) for k, v in by(test, "locale").items()],
                         *[(f"文件类型 {k}", v) for k, v in by(test, "file").items()],
                         ("校准集合计", calib)]:
        c = tally(group, th)
        lines.append(f"| {title} | {c['total']} | " + " | ".join(str(c[k]) for k in NAMES) +
                     f" | {c['error_rate']:.1%} |")
    closed = summary["test_closed_set"]
    lines.append(f"\n不设阈值、总推荐最高分：测试集推荐对了 {closed['correct']}，推荐错了 {closed['wrong']}，"
                 f"不该推荐却推荐 {closed['wrong_accept']}，错误推荐率 {closed['error_rate']:.1%}")
    return summary, "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("baseline", "embedding"), required=True)
    parser.add_argument("--model", choices=tuple(FILES), default="q8")
    parser.add_argument("--max-error-rate", type=float, default=.05)
    parser.add_argument("--port", type=int, default=8098)
    parser.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    parser.add_argument("--server-bin", type=Path)
    args = parser.parse_args()
    profiles, presets, docs = load()
    output = ROOT / "results" / "classification"
    output.mkdir(parents=True, exist_ok=True)
    if args.backend == "baseline":
        rows, stem = baseline_rows(profiles, presets, docs), "match-baseline"
    else:
        model = (ROOT / "models" / FILES[args.model]).resolve()
        if not model.is_file():
            raise FileNotFoundError(f"{model}（先运行 classification/download.py qwen3-embedding-{args.model}）")
        configured = args.server_bin or os.environ.get("MORPH_LLAMA_SERVER_BIN") or shutil.which("llama-server")
        if not configured:
            raise FileNotFoundError("Set --server-bin or MORPH_LLAMA_SERVER_BIN")
        stem = f"match-{model.stem}"
        with LlamaEmbedder(Path(configured).expanduser().resolve(), model, args.port, args.threads,
                           output / f"{stem}.log") as embedder:
            rows = embedding_rows(profiles, presets, docs, embedder)
    summary, text = report(rows, args.max_error_rate)
    (output / f"{stem}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
                                         encoding="utf-8")
    (output / f"{stem}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
