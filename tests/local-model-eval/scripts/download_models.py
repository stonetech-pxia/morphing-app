"""按固定 revision 下载公开 GGUF，并记录本机 SHA-256。"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / "hf-cache"))
from huggingface_hub import hf_hub_download  # noqa: E402


def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(8*1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()


if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("model",nargs="*",help="不写则下载全部")
    a=p.parse_args()
    models=json.loads((ROOT/"models.json").read_text(encoding="utf-8"))
    selected=[m for m in models if not a.model or m["id"] in a.model]
    if len(selected)!=(len(a.model) if a.model else len(models)): p.error("未知模型 id")
    for m in selected:
        dest=ROOT/"models"/m["id"]; dest.mkdir(parents=True,exist_ok=True)
        path=Path(hf_hub_download(repo_id=m["repo"],filename=m["file"],revision=m["revision"],local_dir=dest))
        digest=sha256(path)
        if "sha256" in m and digest.lower()!=m["sha256"].lower():
            raise ValueError(f"SHA-256 mismatch for {m['id']}: {digest}")
        record={**m,"path":str(path),"size_bytes":path.stat().st_size,"sha256":digest}
        (dest/"provenance.json").write_text(json.dumps(record,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print(m["id"],record["size_bytes"],record["sha256"],flush=True)
