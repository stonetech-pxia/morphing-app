"""将评测机的软件和硬件信息保存为可复现元数据。"""
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

import PIL
import huggingface_hub
import psutil
import requests

ROOT=Path(__file__).resolve().parents[1]
def call(*cmd):
    try: return subprocess.check_output(cmd,text=True,stderr=subprocess.STDOUT,timeout=10).strip()
    except (OSError,subprocess.SubprocessError): return None

server=os.environ.get("MORPH_LLAMA_SERVER_BIN") or shutil.which("llama-server")
info={"os":platform.platform(),"os_version":platform.version(),
      "cpu_model":call("node","-e","process.stdout.write(require('os').cpus()[0].model)"),"cpu":platform.processor(),
      "physical_cores":psutil.cpu_count(logical=False),"logical_processors":psutil.cpu_count(logical=True),
      "ram_bytes":psutil.virtual_memory().total,
      "workspace_disk_free_bytes":shutil.disk_usage(ROOT).free,
      "python":sys.version,"node":call("node","--version"),
      "llama_cpp":call(server,"--version") if server else None,
      "nvidia":call("nvidia-smi","--query-gpu=name,memory.total,driver_version","--format=csv,noheader"),
      "packages":{"Pillow":PIL.__version__,"huggingface_hub":huggingface_hub.__version__,"psutil":psutil.__version__,"requests":requests.__version__},
      "git_revision":call("git","-C",str(ROOT),"rev-parse","HEAD")}
(ROOT/"results").mkdir(exist_ok=True)
(ROOT/"results"/"environment.json").write_text(json.dumps(info,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(info,ensure_ascii=False,indent=2))
