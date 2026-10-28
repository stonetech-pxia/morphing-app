"""按固定 revision 下载分类候选并核对权重哈希。"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from huggingface_hub import snapshot_download

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEST = {"nli": "cls-minilm-nli", "mdeberta-nli": "cls-mdeberta-nli",
        "e5": "cls-e5-small", "minilm-embedding": "cls-minilm-embedding",
        "qwen3-embedding": "cls-qwen3-embedding-06b"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", choices=tuple(DEST))
    args = parser.parse_args()
    manifest = {m["id"]: m for m in json.loads((HERE / "models.json").read_text(encoding="utf-8"))}
    entry = manifest[args.model]
    directory = ROOT / "models" / DEST[args.model]
    snapshot_download(repo_id=entry["repo"], revision=entry["revision"],
                      allow_patterns=["*.json", "*.model", "*.txt", "*.safetensors"],
                      ignore_patterns=["onnx/*", "openvino/*", "tf_model.h5"],
                      local_dir=directory)
    weight = directory / entry["file"]
    with weight.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != entry["sha256"]:
        raise ValueError(f"SHA-256 mismatch for {args.model}: {digest}")
    print(args.model, weight.stat().st_size, digest)


if __name__ == "__main__":
    main()
