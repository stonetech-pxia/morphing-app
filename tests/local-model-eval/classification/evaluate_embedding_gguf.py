"""用 llama.cpp CPU 验证 Qwen3 Embedding GGUF 的分类、内存和速度。"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import statistics
import subprocess
import threading
import time
from pathlib import Path

import psutil
import requests

from evaluate import CASES, LANG_INDEX, choices, damaged_text

ROOT = Path(__file__).resolve().parents[1]
FILES = {"q4": "cls-qwen3-embedding-06b-q4/Qwen3-Embedding-0.6B-Q4_K_M.gguf",
         "q8": "cls-qwen3-embedding-06b-q8/Qwen3-Embedding-0.6B-Q8_0.gguf"}


def emb_options(server: Path, model: Path, port: int, threads: int, noise: bool) -> dict:
    base = f"http://127.0.0.1:{port}"
    output = ROOT / "results/classification"
    output.mkdir(parents=True, exist_ok=True)
    log = (output / f"qwen-embedding-gguf-{model.stem}.log").open("w", encoding="utf-8")
    command = [str(server), "--model", str(model), "--host", "127.0.0.1", "--port", str(port),
               "--ctx-size", "2048", "--parallel", "1", "--threads", str(threads),
               "--n-gpu-layers", "0", "--embedding", "--pooling", "last", "--no-webui"]
    start = time.perf_counter()
    proc = subprocess.Popen(command, cwd=server.parent, stdout=log, stderr=subprocess.STDOUT,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    process = psutil.Process(proc.pid)
    peaks = {"rss": 0, "private": 0}
    active = threading.Event()
    active.set()

    def sample_memory() -> None:
        while active.is_set():
            try:
                memory = process.memory_info()
                peaks["rss"] = max(peaks["rss"], memory.rss)
                peaks["private"] = max(peaks["private"], getattr(memory, "private", 0))
            except psutil.Error:
                break
            time.sleep(.02)

    monitor = threading.Thread(target=sample_memory, daemon=True)
    monitor.start()
    try:
        deadline = time.perf_counter() + 150
        while time.perf_counter() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"llama-server exited {proc.returncode}; see {log.name}")
            try:
                if requests.get(base + "/health", timeout=2).json().get("status") == "ok":
                    break
            except (requests.RequestException, ValueError):
                pass
            time.sleep(.2)
        else:
            raise TimeoutError(f"llama-server did not become ready; see {log.name}")
        loaded_s = time.perf_counter() - start
        session = requests.Session()

        def embed(inputs: list[str]) -> list[list[float]]:
            response = session.post(base + "/v1/embeddings", json={"input": inputs}, timeout=120)
            response.raise_for_status()
            rows = sorted(response.json()["data"], key=lambda item: item["index"])
            vectors = []
            for row in rows:
                vector = row["embedding"]
                norm = math.sqrt(sum(value * value for value in vector))
                if not norm:
                    raise ValueError("llama-server returned a zero embedding")
                vectors.append([value / norm for value in vector])
            return vectors

        setup_start = time.perf_counter()
        # 用户类别的向量只需在类别增删或改描述时重算。
        candidates = {(lang, facet): embed([sentence for _, sentence in choices(facet, lang)])
                      for lang in LANG_INDEX for facet in ("kind", "topic")}
        setup_s = time.perf_counter() - setup_start
        rows = []
        for case in CASES:
            if case["kind"] == "unknown":
                continue
            for facet in ("kind", "topic"):
                task = f"Given OCR text, retrieve the {facet} category that best describes it"
                source = damaged_text(case) if noise else case["text"]
                query = f"Instruct: {task}\nQuery: {source}"
                t0 = time.perf_counter()
                vector = embed([query])[0]
                elapsed = time.perf_counter() - t0
                scores = [sum(a * b for a, b in zip(vector, candidate))
                          for candidate in candidates[(case["lang"], facet)]]
                options = choices(facet, case["lang"])
                best = max(range(len(scores)), key=scores.__getitem__)
                rows.append({"id": case["id"], "lang": case["lang"], "facet": facet,
                             "truth": case[facet], "predicted": options[best][0],
                             "score": scores[best], "elapsed_s": elapsed})
        summary = {}
        for facet in ("kind", "topic"):
            facet_rows = [row for row in rows if row["facet"] == facet]
            timings = sorted(row["elapsed_s"] for row in facet_rows)
            summary[facet] = {"correct": sum(row["truth"] == row["predicted"] for row in facet_rows),
                              "total": len(facet_rows), "median_s": statistics.median(timings),
                              "p95_s": timings[math.ceil(.95 * len(timings)) - 1]}
        result = {"model_file": str(model), "noise": noise, "model_bytes": model.stat().st_size,
                  "startup_s": loaded_s, "candidate_setup_s": setup_s,
                  "peak_working_set_bytes": peaks["rss"], "peak_private_bytes": peaks["private"],
                  "summary": summary}
        stem = f"qwen-embedding-gguf-{model.stem}{'-noise' if noise else ''}"
        (output / f"{stem}.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
        (output / f"{stem}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return result
    finally:
        active.clear()
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        monitor.join()
        log.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=tuple(FILES), required=True)
    parser.add_argument("--noise", action="store_true")
    parser.add_argument("--port", type=int, default=8096)
    parser.add_argument("--threads", type=int, default=16)
    parser.add_argument("--server-bin", type=Path)
    args = parser.parse_args()
    model = (ROOT / "models" / FILES[args.model]).resolve()
    if not model.is_file():
        raise FileNotFoundError(model)
    configured = args.server_bin or os.environ.get("MORPH_LLAMA_SERVER_BIN") or shutil.which("llama-server")
    if not configured:
        raise FileNotFoundError("Set --server-bin or MORPH_LLAMA_SERVER_BIN")
    server = Path(configured).expanduser().resolve()
    print(json.dumps(emb_options(server, model, args.port, args.threads, args.noise), ensure_ascii=False))


if __name__ == "__main__":
    main()
