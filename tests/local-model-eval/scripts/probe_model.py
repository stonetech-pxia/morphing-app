"""诊断思考模式和 JSON 约束的单条请求；不计入正式成绩。"""
import argparse
import json
from pathlib import Path
import requests
from run_eval import ROOT,BASE,SYSTEM,prompt_for,schema_for,start_server

p=argparse.ArgumentParser();p.add_argument("model");p.add_argument("--max-tokens",type=int,default=512);a=p.parse_args()
m=next(x for x in json.loads((ROOT/"models.json").read_text(encoding="utf-8")) if x["id"]==a.model)
folder=ROOT/"data"/"receipts-en-001-clean"
schema=json.loads((folder/"schema.json").read_text(encoding="utf-8"));ocr=(folder/"ocr.txt").read_text(encoding="utf-8")
proc,log=start_server(ROOT/"models"/m["id"]/m["file"],"cpu",16,ROOT/"results"/"logs"/(m["id"]+"-probe.log"))
try:
    for no_think in (False,True):
        user=prompt_for(schema,ocr,"shared")+("\n/no_think" if no_think else "")
        body={"messages":[{"role":"system","content":SYSTEM},{"role":"user","content":user}],
              "temperature":0,"seed":42,"max_tokens":a.max_tokens,"stream":False,
              "reasoning_effort":"none","response_format":{"type":"json_object","schema":schema_for(schema["fields"])}}
        response=requests.post(BASE+"/v1/chat/completions",json=body,timeout=200).json()
        choice=response.get("choices",[{}])[0]
        print(json.dumps({"no_think":no_think,"finish":choice.get("finish_reason"),"message":choice.get("message"),"error":response.get("error"),"timings":response.get("timings")},ensure_ascii=True)[:4000])
finally:
    proc.terminate();proc.wait(timeout=10);log.close()
