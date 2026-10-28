"""独立 OCR 文本的动态候选类别评测；模型文件和结果均不入库。"""
from __future__ import annotations

import argparse
import json
import random
import time
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CASES = [json.loads(line) for line in (Path(__file__).with_name("cases.jsonl")).read_text(encoding="utf-8").splitlines() if line]
KINDS = {
    "receipt": ("收据或付款小票", "purchase receipt", "ticket de caisse"),
    "invoice": ("发票或请款单", "invoice requesting payment", "facture à payer"),
    "ticket": ("车票或入场票", "travel or admission ticket", "billet de transport ou d'entrée"),
    "order": ("尚待履行的订单", "order awaiting fulfillment", "commande à traiter"),
    "email": ("电子邮件", "email message", "courriel"),
    "business_card": ("名片", "business card", "carte de visite"),
    "contract": ("合同或协议", "contract or agreement", "contrat ou accord"),
    "medical_report": ("医疗检验报告", "medical test report", "compte rendu d'analyse médicale"),
    "bank_statement": ("银行账户流水", "bank account statement", "relevé de compte bancaire"),
    "menu": ("餐厅菜单", "restaurant menu", "menu de restaurant"),
    "recipe": ("烹饪食谱", "cooking recipe", "recette de cuisine"),
    "meeting_notes": ("会议纪要", "meeting notes", "compte rendu de réunion"),
    "school_notice": ("学校通知", "school notice", "avis scolaire"),
    "shipping_label": ("快递面单", "shipping label", "étiquette d'expédition"),
    "utility_bill": ("水电账单", "utility bill", "facture d'électricité ou d'eau"),
    "travel_itinerary": ("旅行行程单", "travel itinerary", "itinéraire de voyage"),
    "government_form": ("政府申请表", "government application form", "formulaire administratif"),
    "advertisement": ("促销广告", "promotional advertisement", "publicité promotionnelle"),
    "note": ("私人便条", "personal note", "note personnelle"),
}
TOPICS = {
    "dining": ("餐饮", "food and dining", "restauration"),
    "shopping": ("购物", "shopping", "achats"),
    "housing": ("住房", "housing", "logement"),
    "work": ("工作", "work", "travail"),
    "travel": ("旅行或交通", "travel or transport", "voyage ou transport"),
    "entertainment": ("娱乐", "entertainment", "loisirs"),
    "education": ("教育", "education", "éducation"),
    "healthcare": ("医疗", "healthcare", "santé"),
    "finance": ("个人财务", "personal finance", "finances personnelles"),
    "government": ("政府事务", "government services", "administration publique"),
    "personal": ("个人生活", "personal life", "vie personnelle"),
}
LANG_INDEX = {"zh": 0, "en": 1, "fr": 2}
HYPOTHESIS = {
    "kind": {"zh": "这份文件是{}。", "en": "This document is a {}.", "fr": "Ce document est un {}."},
    "topic": {"zh": "这段文字的主题是{}。", "en": "This text is about {}.", "fr": "Ce texte concerne {}."},
}


def damaged_text(case: dict) -> str:
    """固定、可复现的文字丢失扰动；不代表平台 OCR 的真实错误分布。"""
    rng = random.Random(sum((i + 1) * ord(ch) for i, ch in enumerate(case["id"])))
    text = case["text"]
    if not text:
        return text
    words = text.split()
    if case["lang"] in ("en", "fr"):
        words = [word for word in words if rng.random() >= .13]
        text = " ".join(words)
    return "".join("?" if not ch.isspace() and rng.random() < .08 else ch for ch in text)


def choices(facet: str, lang: str) -> list[tuple[str, str]]:
    labels = KINDS if facet == "kind" else TOPICS
    return [(key, HYPOTHESIS[facet][lang].format(names[LANG_INDEX[lang]])) for key, names in labels.items()]


def evaluate_embeddings(model_dir: Path, facet: str, model_name: str, noise: bool) -> list[dict]:
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(str(model_dir), device="cpu", local_files_only=True)
    model.max_seq_length = min(model.max_seq_length, 512)
    rows = []
    for lang in LANG_INDEX:
        cases = [c for c in CASES if c["lang"] == lang and c["kind"] != "unknown"]
        options = choices(facet, lang)
        source = [("query: " if model_name == "e5" else "") + (damaged_text(c) if noise else c["text"]) for c in cases]
        labels = [("passage: " if model_name == "e5" else "") + sentence for _, sentence in options]
        t0 = time.monotonic()
        if model_name == "qwen3-embedding":
            task = f"Given OCR text, retrieve the {facet} category that best describes it"
            queries = model.encode(source, batch_size=8, normalize_embeddings=True, show_progress_bar=False,
                                   prompt=f"Instruct: {task}\nQuery: ")
            options_vectors = model.encode(labels, batch_size=8, normalize_embeddings=True, show_progress_bar=False)
            vectors = np.concatenate((queries, options_vectors))
        else:
            vectors = model.encode(source + labels, batch_size=16, normalize_embeddings=True, show_progress_bar=False)
        elapsed = time.monotonic() - t0
        scores = vectors[:len(source)] @ vectors[len(source):].T
        for i, case in enumerate(cases):
            ranked = np.argsort(scores[i])[::-1]
            rows.append({"id": case["id"], "lang": lang, "facet": facet, "truth": case[facet],
                         "predicted": options[ranked[0]][0], "score": float(scores[i, ranked[0]]),
                         "runner_up": options[ranked[1]][0], "margin": float(scores[i, ranked[0]] - scores[i, ranked[1]]),
                         "batch_elapsed_s": elapsed})
    return rows


def evaluate_nli(model_dir: Path, facet: str, noise: bool) -> list[dict]:
    import torch

    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(str(model_dir), local_files_only=True)
    model = AutoModelForSequenceClassification.from_pretrained(str(model_dir), local_files_only=True).eval()
    labels = {k.lower(): v for k, v in model.config.label2id.items()}
    entailment = next(v for k, v in labels.items() if "entail" in k)
    rows = []
    for case in CASES:
        if case["kind"] == "unknown":
            continue
        options = choices(facet, case["lang"])
        t0 = time.monotonic()
        all_scores = []
        with torch.inference_mode():
            for start in range(0, len(options), 16):
                chunk = options[start:start + 16]
                inputs = tokenizer([damaged_text(case) if noise else case["text"]] * len(chunk), [x[1] for x in chunk],
                                   padding=True, truncation=True, max_length=512, return_tensors="pt")
                logits = model(**inputs).logits
                all_scores.extend(torch.softmax(logits, dim=-1)[:, entailment].tolist())
        ranked = np.argsort(all_scores)[::-1]
        rows.append({"id": case["id"], "lang": case["lang"], "facet": facet,
                     "truth": case[facet], "predicted": options[ranked[0]][0],
                     "score": all_scores[ranked[0]], "runner_up": options[ranked[1]][0],
                     "margin": all_scores[ranked[0]] - all_scores[ranked[1]],
                     "elapsed_s": time.monotonic() - t0})
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=("e5", "nli", "mdeberta-nli", "minilm-embedding", "qwen3-embedding", "bge-m3"), required=True)
    parser.add_argument("--facet", choices=("kind", "topic"), required=True)
    parser.add_argument("--noise", action="store_true")
    args = parser.parse_args()
    model_dirs = {"e5": ROOT / "models/cls-e5-small", "nli": ROOT / "models/cls-minilm-nli",
                  "mdeberta-nli": ROOT / "models/cls-mdeberta-nli",
                  "minilm-embedding": ROOT / "models/cls-minilm-embedding",
                  "qwen3-embedding": ROOT / "models/cls-qwen3-embedding-06b",
                  "bge-m3": ROOT / "models/cls-bge-m3"}
    if args.model in ("nli", "mdeberta-nli"):
        rows = evaluate_nli(model_dirs[args.model], args.facet, args.noise)
    else:
        rows = evaluate_embeddings(model_dirs[args.model], args.facet, args.model, args.noise)
    truth = [r["truth"] for r in rows]
    pred = [r["predicted"] for r in rows]
    class_ids = list(KINDS if args.facet == "kind" else TOPICS)
    f1_per_class = []
    for class_id in class_ids:
        tp = sum(a == class_id and b == class_id for a, b in zip(truth, pred))
        fp = sum(a != class_id and b == class_id for a, b in zip(truth, pred))
        fn = sum(a == class_id and b != class_id for a, b in zip(truth, pred))
        f1_per_class.append(2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0)
    summary = {"model": args.model, "facet": args.facet, "n": len(rows),
               "accuracy": sum(a == b for a, b in zip(truth, pred)) / len(rows),
               "macro_f1": sum(f1_per_class) / len(f1_per_class),
               "by_language": {lang: {"correct": sum(r["truth"] == r["predicted"] for r in rows if r["lang"] == lang),
                                      "total": sum(r["lang"] == lang for r in rows)} for lang in LANG_INDEX},
               "errors": [r for r in rows if r["truth"] != r["predicted"]],
               "confusion": dict(Counter((r["truth"], r["predicted"]) for r in rows if r["truth"] != r["predicted"]))}
    summary["confusion"] = [{"truth": a, "predicted": b, "count": n} for (a, b), n in summary["confusion"].items()]
    output = ROOT / "results/classification"
    output.mkdir(parents=True, exist_ok=True)
    stem = f"{args.model}-{args.facet}{'-noise' if args.noise else ''}"
    (output / f"{stem}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    (output / f"{stem}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("model", "facet", "n", "accuracy", "macro_f1", "by_language")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
