"""用本机 llama-server 逐条评测；每条原始回复立即写入 JSONL，可断点续跑。"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import psutil
import requests

ROOT=Path(__file__).resolve().parents[1]
PORT=int(os.environ.get("MORPH_EVAL_PORT","8091"))
BASE=f"http://127.0.0.1:{PORT}"
SYSTEM=("You extract only facts explicitly supported by the OCR text. Return exactly one JSON object keyed by the given field IDs. "
        "For any missing, ambiguous, or unreadable field return null; never infer or invent it. "
        "For amount, use the final total or amount paid, not subtotal, discount, tax or change. "
        "Normalize dates to YYYY-MM-DD using the document language's date order. "
        "For a choice field, use one option ID only if text supports it. Do not use knowledge outside the text. "
        "Output no explanation, markdown or extra keys.")
SUMMARY_SYSTEM=("Summarize the following OCR text in the same language. Include only stated facts. "
                "Use at most 100 Chinese characters or 60 English/French words. "
                "Do not invent dates, amounts, obligations or parties. Output only the summary.")


def schema_for(fields: list[dict], null_first: bool = False) -> dict:
    properties={}
    for f in fields:
        typ=f["type"]
        if typ in ("money","number"): value={"type":"number"}
        elif typ=="checkbox": value={"type":"boolean"}
        elif typ=="rating": value={"type":"integer","minimum":1,"maximum":5}
        elif typ=="choice": value={"type":"string","enum":[o["id"] for o in f["options"]]}
        else: value={"type":"string"}
        choices=[value,{"type":"null"}]
        properties[f["id"]]={"anyOf":list(reversed(choices)) if null_first else choices}
    return {"type":"object","properties":properties,"required":list(properties),"additionalProperties":False}


def prompt_for(schema: dict, ocr: str, variant: str, language: str | None = None) -> str:
    fields=[]
    for f in schema["fields"]:
        x={k:f[k] for k in ("id","name","type","currency","options") if k in f}
        fields.append(x)
    prefix="Extract fields from this OCR. The language and date order are determined by the text."
    if variant=="strict":
        prefix+=(" Before filling each field, require a visible matching line. An absent field is null even if a typical document would contain it."
                 " invoiceNo requires a line explicitly labelled Invoice No, Facture n°, 发票号, Order No, Commande n°, or 订单号; a phone, address, or test label is never an invoice number."
                 " tax requires a line explicitly labelled Tax, TVA, or 税额; discount, change, subtotal, HT and TTC are not a tax amount."
                 " A category requires an explicit Type, 用途, or similar category label; do not guess it from a merchant name."
                 " Convert 21/10/2026 in French to 2026-10-21 and 10/21/2026 in English to 2026-10-21.")
    if variant=="evidence":
        prefix+=(" Each non-null value must be supported by a visible OCR line; otherwise write null."
                 " For invoiceNo, require an explicit invoice, order, or receipt number label, such as Invoice No, Facture n°, 发票号, Order No, Commande n°, or 订单号."
                 " An address, phone number, sample watermark, or test label is not a document number."
                 " For tax, require an explicit Tax, TVA, or 税额 line. Discount, change, subtotal, HT, and TTC alone are not tax."
                 " Select a category only when the text explicitly gives a Type or 用途 that matches an option; never infer it from the merchant."
                 " Parse dates from OCR only: French numeric dates are day/month/year, English numeric dates are month/day/year, Chinese dates are year/month/day."
                 " Never copy any value from these instructions into the answer.")
    if variant=="evidence_locale":
        locale={"en":("English","month/day/year"),"fr":("French","day/month/year"),"zh":("Chinese","year/month/day")}[language]
        prefix+=(f" The document language is {locale[0]}; numeric dates follow {locale[1]}."
                 " Take date digits only from a visible date line and normalize to year-month-day."
                 " A non-null value requires its own supporting OCR line; missing or ambiguous values are null."
                 " For invoiceNo, require an explicit Invoice No, Facture n°, 发票号, Order No, Commande n°, or 订单号 label with its identifier on the same line."
                 " Address, phone, item lines, sample watermarks, and test labels cannot be document numbers."
                 " For tax, require a separate line beginning with Tax, TVA, or 税额 followed by a monetary amount."
                 " Total TTC, Sous-total HT, discount, and change do not qualify as a tax line."
                 " Choose a category only when an explicit Type or 用途 line supports an option ID."
                 " Never take an answer value from these instructions.")
    if variant in ("date_parts","date_parts_tax"):
        order={"en":"If the date line has A/B/C, output year C, month A, day B; do not swap A and B.",
               "fr":"If the date line has A/B/C, output year C, month B, day A; do not swap A and B.",
               "zh":"Keep the year/month/day order shown by the Chinese date line."}[language]
        prefix+=(" A value without a supporting OCR line is null. A tax value needs a separate line starting with Tax, TVA, or 税额 and a numeric amount."
                 " An invoiceNo needs a document-number label and its identifier on the same line. Never use address, phone, item, sample, or test text as a document number."
                 " Use a category only from a visible Type or 用途 line."
                 f" The document language is {language}. For date conversion: {order}"
                 " Read the three groups from the OCR date line; add leading zeros to month and day and join as YYYY-MM-DD."
                 " Do not copy a value from these instructions.")
        if variant=="date_parts_tax":
            prefix+=(" Tax is null unless the OCR contains a distinct tax amount line."
                     " A Chinese 优惠 or 折扣 line is a discount, never tax."
                     " An English Discount or French Remise line is also never tax."
                     " TTC and HT within a total or subtotal label do not provide a tax amount.")
    return prefix+"\nFIELDS: "+json.dumps(fields,ensure_ascii=False,separators=(",",":"))+"\nOCR:\n"+ocr+"\nJSON:"


def memory_bytes(proc: subprocess.Popen) -> int:
    try:
        p=psutil.Process(proc.pid)
        processes=[p,*p.children(recursive=True)]
        return sum(getattr(x.memory_info(),"peak_wset",x.memory_info().rss) for x in processes)
    except psutil.Error:
        return 0


def start_server(model: Path, backend: str, threads: int, log: Path) -> tuple[subprocess.Popen,object]:
    configured=os.environ.get("MORPH_LLAMA_SERVER_BIN")
    bundled=ROOT/"tools"/("llama-cpu" if backend=="cpu" else "llama-cuda")/"llama-server.exe"
    found=configured or (str(bundled) if bundled.exists() else shutil.which("llama-server"))
    if not found: raise FileNotFoundError("Set MORPH_LLAMA_SERVER_BIN or install llama-server on PATH")
    exe=Path(found).expanduser().resolve()
    log.parent.mkdir(parents=True,exist_ok=True)
    logfile=log.open("ab")
    cmd=[str(exe),"--model",str(model),"--host","127.0.0.1","--port",str(PORT),
         "--ctx-size","4096","--parallel","1","--threads",str(threads),
         "--n-gpu-layers","0" if backend=="cpu" else "99","--reasoning","off","--no-webui"]
    proc=subprocess.Popen(cmd,cwd=str(exe.parent),stdout=logfile,stderr=subprocess.STDOUT,
                          creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    until=time.monotonic()+150
    while time.monotonic()<until:
        if proc.poll() is not None:
            logfile.close(); raise RuntimeError(f"llama-server exited {proc.returncode}; see {log}")
        try:
            if requests.get(BASE+"/health",timeout=2).json().get("status")=="ok": return proc,logfile
        except (requests.RequestException,ValueError): pass
        time.sleep(.6)
    proc.terminate(); logfile.close(); raise TimeoutError(f"llama-server did not become ready; see {log}")


def choose_samples(mode: str, pilot: bool) -> list[Path]:
    samples=[p for p in sorted((ROOT/"data").iterdir()) if (p/"meta.json").exists()]
    if mode=="summary": samples=[p for p in samples if p.name.startswith("long-")]
    if pilot:
        buckets={}
        for p in samples:
            meta=json.loads((p/"meta.json").read_text(encoding="utf-8"))
            key=(meta["language"],meta["category"],meta["difficulty"])
            if buckets.get(key,0)<1: buckets[key]=1
            else: continue
            yield p
    else:
        yield from samples


def run(args: argparse.Namespace) -> None:
    models={m["id"]:m for m in json.loads((ROOT/"models.json").read_text(encoding="utf-8"))}
    m=models[args.model]
    model=ROOT/"models"/m["id"]/m["file"]
    if not model.exists(): raise FileNotFoundError(model)
    suffix=("-nullfirst" if args.null_first else "")+("-pilot" if args.pilot else "")
    out=ROOT/"results"/f"{m['id']}-{args.backend}-{args.mode}-{args.prompt}{suffix}.jsonl"
    out.parent.mkdir(exist_ok=True)
    done=set()
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            if line:
                old=json.loads(line)
                if old.get("error") is None: done.add(old["sample_id"])
    log=ROOT/"results"/"logs"/f"{m['id']}-{args.backend}.log"
    proc,logfile=start_server(model,args.backend,args.threads,log)
    peak=memory_bytes(proc)
    session=requests.Session()
    try:
        with out.open("a",encoding="utf-8") as stream:
            samples=list(choose_samples(args.mode,args.pilot))
            if args.category:
                samples=[p for p in samples if json.loads((p/"meta.json").read_text(encoding="utf-8"))["category"]==args.category]
            if args.difficulty:
                samples=[p for p in samples if json.loads((p/"meta.json").read_text(encoding="utf-8"))["difficulty"]==args.difficulty]
            if args.language:
                samples=[p for p in samples if json.loads((p/"meta.json").read_text(encoding="utf-8"))["language"]==args.language]
            if args.max_samples: samples=samples[:args.max_samples]
            for n,folder in enumerate(samples,1):
                if folder.name in done: continue
                schema=json.loads((folder/"schema.json").read_text(encoding="utf-8"))
                ocr=(folder/"ocr.txt").read_text(encoding="utf-8")
                if args.mode=="summary":
                    if args.prompt=="summary_locale":
                        language=json.loads((folder/"meta.json").read_text(encoding="utf-8"))["language"]
                        language_name={"en":"English","fr":"French","zh":"Chinese"}[language]
                        system=SUMMARY_SYSTEM+f" The OCR language is {language_name}. Write the entire summary in {language_name}."
                    else:
                        system=SUMMARY_SYSTEM
                    messages=[{"role":"system","content":system},{"role":"user","content":ocr}]
                else:
                    language=json.loads((folder/"meta.json").read_text(encoding="utf-8"))["language"]
                    messages=[{"role":"system","content":SYSTEM},{"role":"user","content":prompt_for(schema,ocr,args.prompt,language)}]
                body={"model":m["id"],"messages":messages,"temperature":0,"seed":42,"max_tokens":256,
                      "cache_prompt":False,"stream":False,"reasoning_effort":"none"}
                if args.mode=="schema": body["response_format"]={"type":"json_object","schema":schema_for(schema["fields"],args.null_first)}
                t0=time.monotonic()
                for attempt in range(2):
                    try:
                        reply=session.post(BASE+"/v1/chat/completions",json=body,timeout=180)
                        reply.raise_for_status()
                        response=reply.json(); text=response["choices"][0]["message"]["content"]
                        error=None; break
                    except (requests.RequestException,KeyError,ValueError) as exc:
                        response={}; text=""; error=str(exc)
                        if attempt==0: time.sleep(2)
                elapsed=time.monotonic()-t0
                peak=max(peak,memory_bytes(proc))
                row={"sample_id":folder.name,"model":m["id"],"backend":args.backend,"mode":args.mode,
                     "prompt":args.prompt,"output":text,"error":error,"elapsed_s":elapsed,
                     "timings":response.get("timings"),"usage":response.get("usage"),"finish_reason":response.get("choices",[{}])[0].get("finish_reason"),
                     "rss_peak_bytes":peak}
                stream.write(json.dumps(row,ensure_ascii=False)+"\n"); stream.flush()
                if n%10==0 or error: print(m["id"],args.mode,n,"/",len(samples),f"{elapsed:.1f}s",error or "",flush=True)
    finally:
        proc.terminate()
        try: proc.wait(timeout=10)
        except subprocess.TimeoutExpired: proc.kill(); proc.wait()
        logfile.close()
    print("saved",out,"peak_rss",peak,flush=True)


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--model",required=True)
    p.add_argument("--backend",choices=("cpu","cuda"),default="cpu")
    p.add_argument("--mode",choices=("free","schema","summary"),default="schema")
    p.add_argument("--prompt",choices=("shared","strict","evidence","evidence_locale","date_parts","date_parts_tax","summary_locale"),default="shared")
    p.add_argument("--pilot",action="store_true")
    p.add_argument("--max-samples",type=int,default=0)
    p.add_argument("--category",choices=tuple(("receipts","invoices","tickets","orders","cards","long","notes")))
    p.add_argument("--difficulty",choices=("clean","normal","hard"))
    p.add_argument("--language",choices=("zh","en","fr"))
    p.add_argument("--threads",type=int,default=16)
    p.add_argument("--null-first",action="store_true",help="Exploratory JSON schema branch-order test")
    args=p.parse_args()
    run(args)
