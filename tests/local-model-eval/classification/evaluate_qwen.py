"""用既有 Qwen3.5 0.8B GGUF 测动态标签与开放命名；结果不入库。"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

from evaluate import CASES, KINDS, TOPICS, choices, damaged_text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from run_eval import BASE, start_server  # noqa: E402


def free_subset() -> list[dict]:
    wanted = {"receipt", "invoice", "order", "email", "menu", "recipe", "medical_report", "bank_statement", "school_notice", "travel_itinerary"}
    return [c for c in CASES if c["kind"] in wanted]


def run(mode: str, backend: str, model_id: str, noise: bool) -> None:
    manifest = {item["id"]: item for item in json.loads((ROOT / "models.json").read_text(encoding="utf-8"))}
    entry = manifest[model_id]
    model = Path(os.environ.get("MORPH_CLASSIFIER_GGUF", str(ROOT / "models" / model_id / entry["file"])))
    if not model.exists():
        raise FileNotFoundError(model)
    output = ROOT / "results/classification"
    output.mkdir(parents=True, exist_ok=True)
    path = output / f"{model_id}-{mode}-{backend}{'-noise' if noise else ''}.jsonl"
    done = {json.loads(line)["id"] for line in path.read_text(encoding="utf-8").splitlines() if line} if path.exists() else set()
    proc, logfile = start_server(model, backend, 16, output / f"{model_id}-{backend}.log")
    session = requests.Session()
    try:
        with path.open("a", encoding="utf-8") as stream:
            for case in free_subset() if mode == "free" else CASES:
                if case["id"] in done:
                    continue
                if mode == "free":
                    instruction = ("Read only the OCR text below. Propose a concise document kind and a separate topic in the same language as the OCR. "
                                   "Use visible evidence only. If unreadable, write null for both. Do not copy previous values. "
                                   "Return JSON with only kind and topic as short strings or null.")
                else:
                    kind = choices("kind", case["lang"])
                    topic = choices("topic", case["lang"])
                    instruction = ("Read only the OCR text. Select one document kind and one topic from these user-editable candidate sets. "
                                   "A document kind describes its format; a topic describes what it concerns. "
                                   "If there is no readable evidence, choose unknown for both. Return only JSON.\n"
                                   "KINDS: " + json.dumps(kind, ensure_ascii=False) + "\nTOPICS: " + json.dumps(topic, ensure_ascii=False))
                schema = {"type": "object", "properties": {"kind": {"type": ["string", "null"]},
                                                            "topic": {"type": ["string", "null"]}},
                          "required": ["kind", "topic"], "additionalProperties": False}
                if mode == "fixed":
                    schema["properties"]["kind"] = {"type": "string", "enum": list(KINDS) + ["unknown"]}
                    schema["properties"]["topic"] = {"type": "string", "enum": list(TOPICS) + ["unknown"]}
                body = {"model": model_id, "messages": [{"role": "system", "content": instruction},
                                                               {"role": "user", "content": "OCR:\n" + (damaged_text(case) if noise else case["text"])}],
                        "temperature": 0, "seed": 42, "max_tokens": 90, "stream": False,
                        "reasoning_effort": "none", "response_format": {"type": "json_object", "schema": schema}}
                t0 = time.monotonic()
                response = session.post(BASE + "/v1/chat/completions", json=body, timeout=120)
                response.raise_for_status()
                answer = response.json()["choices"][0]["message"]["content"]
                try:
                    parsed = json.loads(answer)
                except json.JSONDecodeError:
                    parsed = None
                row = {"id": case["id"], "lang": case["lang"], "truth_kind": case["kind"],
                       "truth_topic": case["topic"], "output": answer, "parsed": parsed,
                       "elapsed_s": time.monotonic() - t0}
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
                stream.flush()
                print(case["id"], answer, flush=True)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
            proc.wait()
        logfile.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=("fixed", "free"), required=True)
    p.add_argument("--backend", choices=("cpu", "cuda"), default="cuda")
    p.add_argument("--model", choices=("qwen35-08b", "qwen35-2b", "qwen35-4b"), default="qwen35-08b")
    p.add_argument("--noise", action="store_true")
    args = p.parse_args()
    run(args.mode, args.backend, args.model, args.noise)
