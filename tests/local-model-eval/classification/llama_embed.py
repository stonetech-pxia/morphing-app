"""启动并停止自己的 llama-server（--embedding --pooling last），只在 127.0.0.1 上，返回归一化的向量。"""
from __future__ import annotations

import math
import subprocess
import time
from pathlib import Path

import requests


class LlamaEmbedder:
    def __init__(self, server: Path, model: Path, port: int, threads: int, log: Path):
        self.base = f"http://127.0.0.1:{port}"
        self.command = [str(server), "--model", str(model), "--host", "127.0.0.1", "--port", str(port),
                        "--ctx-size", "2048", "--parallel", "1", "--threads", str(threads),
                        "--n-gpu-layers", "0", "--embedding", "--pooling", "last", "--no-webui"]
        self.server = server
        self.log_path = log
        self.proc: subprocess.Popen | None = None
        self.session = requests.Session()

    def __enter__(self) -> "LlamaEmbedder":
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.log = self.log_path.open("w", encoding="utf-8")
        self.proc = subprocess.Popen(self.command, cwd=self.server.parent, stdout=self.log,
                                     stderr=subprocess.STDOUT,
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        deadline = time.perf_counter() + 150
        while time.perf_counter() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"llama-server exited {self.proc.returncode}; see {self.log_path}")
            try:
                if self.session.get(self.base + "/health", timeout=2).json().get("status") == "ok":
                    return self
            except (requests.RequestException, ValueError):
                pass
            time.sleep(.2)
        self.__exit__(None, None, None)
        raise TimeoutError(f"llama-server did not become ready; see {self.log_path}")

    def __exit__(self, *_exc) -> None:
        if self.proc is not None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
            self.proc = None
        self.log.close()

    def embed(self, inputs: list[str]) -> list[list[float]]:
        response = self.session.post(self.base + "/v1/embeddings", json={"input": inputs}, timeout=120)
        response.raise_for_status()
        vectors = []
        for row in sorted(response.json()["data"], key=lambda item: item["index"]):
            vector = row["embedding"]
            norm = math.sqrt(sum(value * value for value in vector))
            if not norm:
                raise ValueError("llama-server returned a zero embedding")
            vectors.append([value / norm for value in vector])
        return vectors


def rank(query: list[float], candidates: list[tuple[str, list[float]]]) -> tuple[str | None, float, float, list]:
    """返回最高分的 id、最高分、和第二名的差（只有一个候选时差为无穷大）以及全部分数。"""
    scores = sorted(((sum(a * b for a, b in zip(query, vector)), cid) for cid, vector in candidates),
                    reverse=True)
    if not scores:
        return None, float("-inf"), 0.0, []
    margin = scores[0][0] - scores[1][0] if len(scores) > 1 else float("inf")
    return scores[0][1], scores[0][0], margin, [(cid, score) for score, cid in scores]
