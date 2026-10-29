"""在固定的 50 张干净小票上顺序运行候选模型，两种输出模式。"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MODELS=json.loads((ROOT/"models.json").read_text(encoding="utf-8"))

for model in MODELS:
    for mode in ("schema","free"):
        command=[sys.executable,str(ROOT/"scripts"/"run_eval.py"),"--model",model["id"],
                 "--backend","cpu","--mode",mode,"--category","receipts","--difficulty","clean"]
        print("START",model["id"],mode,flush=True)
        code=subprocess.call(command,cwd=ROOT)
        print("DONE",model["id"],mode,"exit",code,flush=True)
        if code: sys.exit(code)
