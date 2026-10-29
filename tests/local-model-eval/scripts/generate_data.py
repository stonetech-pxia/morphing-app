"""生成不含真实个人信息的三语单据与模拟 OCR；固定种子便于复测。"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


COUNTS = {
    "receipts": {"zh": 20, "en": 15, "fr": 15},
    "invoices": {"zh": 12, "en": 8, "fr": 8},
    "tickets": {"zh": 6, "en": 6, "fr": 4},
    "orders": {"zh": 10, "en": 6, "fr": 4},
    "cards": {"zh": 6, "en": 6, "fr": 4},
    "long": {"zh": 6, "en": 6, "fr": 6},
    "notes": {"zh": 5, "en": 3, "fr": 3},
}
DIFFICULTIES = ("clean", "normal", "hard")
NAMES = {
    "zh": {"amount": ["金额", "实付", "花了多少"], "date": ["日期", "消费日期"], "merchant": ["商家", "店名"], "invoiceNo": ["单号", "发票号"], "category": ["分类", "支出类别"], "tax": ["税额"], "name": ["姓名"], "phone": ["电话"], "email": ["邮箱"], "company": ["公司"], "origin": ["出发地"], "destination": ["目的地"]},
    "en": {"amount": ["Amount", "Paid"], "date": ["Date", "Purchase date"], "merchant": ["Merchant", "Store"], "invoiceNo": ["Invoice number", "Reference"], "category": ["Category", "Expense type"], "tax": ["Tax"], "name": ["Name"], "phone": ["Phone"], "email": ["Email"], "company": ["Company"], "origin": ["From"], "destination": ["To"]},
    "fr": {"amount": ["Montant", "Payé"], "date": ["Date", "Date d'achat"], "merchant": ["Commerçant", "Enseigne"], "invoiceNo": ["Numéro de facture", "Référence"], "category": ["Catégorie", "Type de dépense"], "tax": ["TVA"], "name": ["Nom"], "phone": ["Téléphone"], "email": ["Courriel"], "company": ["Société"], "origin": ["Départ"], "destination": ["Arrivée"]},
}
MERCHANTS = {
    "zh": [("青禾餐馆", "food"), ("南门面馆", "food"), ("星桥超市", "other"), ("松木书店", "other"), ("北辰出行", "transport"), ("远航出租", "transport"), ("东街加油站", "transport")],
    "en": [("Willow Cafe", "food"), ("Maple Diner", "food"), ("North Market", "other"), ("Elm Books", "other"), ("Harbor Taxi", "transport"), ("City Cab", "transport"), ("River Fuel", "transport")],
    "fr": [("Café des Lilas", "food"), ("Bistro Aube", "food"), ("Marché du Canal", "other"), ("Librairie Sable", "other"), ("Taxi Étoile", "transport"), ("VTC Rivière", "transport"), ("Station des Pins", "transport")],
}
CHOICES = {"zh": [("food", "餐饮"), ("transport", "交通"), ("other", "其他")], "en": [("food", "Food"), ("transport", "Transport"), ("other", "Other")], "fr": [("food", "Restauration"), ("transport", "Transport"), ("other", "Autres")]}
CURRENCY = {"zh": "CNY", "en": "USD", "fr": "EUR"}
LABELS = {
    "zh": {"subtotal": "小计", "discount": "优惠", "total": "实付", "change": "找零", "date": "日期", "tax": "税额", "invoice": "发票号", "order": "订单号", "phone": "电话", "email": "邮箱", "from": "出发", "to": "到达"},
    "en": {"subtotal": "Subtotal", "discount": "Discount", "total": "Amount paid", "change": "Change", "date": "Date", "tax": "Tax", "invoice": "Invoice No", "order": "Order No", "phone": "Phone", "email": "Email", "from": "From", "to": "To"},
    "fr": {"subtotal": "Sous-total HT", "discount": "Remise", "total": "Total TTC payé", "change": "Monnaie rendue", "date": "Date", "tax": "TVA", "invoice": "Facture n°", "order": "Commande n°", "phone": "Téléphone", "email": "Courriel", "from": "Départ", "to": "Arrivée"},
}
FONT_CANDIDATES = {
    "zh": ("C:/Windows/Fonts/msyh.ttc", "/System/Library/Fonts/PingFang.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    "en": ("C:/Windows/Fonts/arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    "fr": ("C:/Windows/Fonts/arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
}


def font_for(locale: str) -> str:
    override = os.environ.get("MORPH_EVAL_FONT_ZH" if locale == "zh" else "MORPH_EVAL_FONT_LATIN")
    candidates = ([override] if override else []) + list(FONT_CANDIDATES[locale])
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    raise FileNotFoundError(f"No font for {locale}; set MORPH_EVAL_FONT_ZH or MORPH_EVAL_FONT_LATIN")


def write_json(path: Path, obj: object) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def money(value: float, locale: str) -> str:
    if locale == "fr":
        return f"{value:.2f}".replace(".", ",") + " €"
    return ("¥" if locale == "zh" else "$") + f"{value:.2f}"


def display_date(iso: str, locale: str, ambiguous: bool) -> str:
    y, m, d = iso.split("-")
    if locale == "zh":
        return f"{y}年{int(m)}月{int(d)}日" if not ambiguous else f"{y}/{m}/{d}"
    if locale == "en":
        return f"{m}/{d}/{y}"
    return f"{d}/{m}/{y}"


def make_schema(category: str, locale: str, rng: random.Random, index: int) -> dict:
    if category in ("receipts", "invoices", "orders"):
        ids = ["amount", "date", "merchant", "category", "invoiceNo"]
        if category in ("receipts", "invoices"): ids.append("tax")
    elif category == "tickets":
        ids = ["date", "merchant", "origin", "destination", "invoiceNo", "amount"]
    elif category == "cards":
        ids = ["name", "phone", "email", "company", "date"]
    else:
        ids = ["date", "amount", "merchant", "invoiceNo", "email"]
    fields = []
    for field_id in ids:
        field_type = "money" if field_id in ("amount", "tax") else "date" if field_id == "date" else "choice" if field_id == "category" else "text"
        f = {"id": field_id, "name": rng.choice(NAMES[locale][field_id]), "type": field_type}
        if field_type == "money": f["currency"] = CURRENCY[locale]
        if field_type == "choice": f["options"] = [{"id": k, "label": v} for k, v in CHOICES[locale]]
        fields.append(f)
    return {"id": f"eval-{category}-{locale}-{index:03}", "name": {"zh": "自动填写测试", "en": "Prefill test", "fr": "Essai de préremplissage"}[locale], "fields": fields}


def make_document(category: str, locale: str, rng: random.Random, index: int, schema: dict) -> tuple[list[tuple[str | None, str]], dict, dict | None]:
    labels = LABELS[locale]
    merchant, group = rng.choice(MERCHANTS[locale])
    amount = round(rng.uniform(5, 380), 2)
    date = f"2026-{rng.randint(1, 10):02}-{rng.randint(1, 28):02}"
    reference = f"{category[:3].upper()}-{2026}{index:04}"
    vals = {f["id"]: None for f in schema["fields"]}
    lines: list[tuple[str | None, str]] = []
    summary = None
    def add(field: str | None, value: str, truth=None):
        lines.append((field, value))
        if field in vals: vals[field] = truth
    add(None, ({"zh":"手写便条","en":"Handwritten note","fr":"Note manuscrite"}[locale] if category=="notes" else merchant))
    add(None, {"zh": "样例单据 · 仅供测试", "en": "SAMPLE DOCUMENT · TEST ONLY", "fr": "DOCUMENT FICTIF · TEST"}[locale])
    add(None, {"zh": "地址：青云路 18 号", "en": "18 Sample Street", "fr": "18 rue Exemple"}[locale])
    if category == "cards":
        name = {"zh": "林晓", "en": "Alex Rowan", "fr": "Camille Laurent"}[locale]
        add("name", name, name)
        add("company", merchant, merchant)
        phone=f"+33 6 12 34 56 {index%10:02}"
        add("phone", f"{labels['phone']}: {phone}", phone)
        if rng.random() < .7: add("email", f"{labels['email']}: sample{index}@example.test", f"sample{index}@example.test")
    elif category == "notes":
        add(None, {"zh": "记得带上旧单据，周三回电。", "en": "Remember to bring the old document. Call back Wednesday.", "fr": "Apporter l'ancien document. Rappeler mercredi."}[locale])
        if rng.random() < .3: add("date", f"{labels['date']}: {display_date(date,locale,False)}", date)
    elif category == "tickets":
        origin, destination = ({"zh": ("上海", "杭州"), "en": ("Boston", "New York"), "fr": ("Paris", "Lyon")})[locale]
        add("date", f"{labels['date']}: {display_date(date,locale,index%4==0)}", date)
        add("origin", f"{labels['from']}: {origin}", origin)
        add("destination", f"{labels['to']}: {destination}", destination)
        add("invoiceNo", f"{labels['order']}: {reference}", reference)
        if rng.random() < .7: add("amount", f"{labels['total']}: {money(amount,locale)}", amount)
        add("merchant", merchant, merchant)
    else:
        if index%3!=0:
            add("date", f"{labels['date']}: {display_date(date,locale,index%4==0)}", date)
        if category=="receipts":
            items={"zh":("商品 A","商品 B","会员积分"),"en":("Item A","Item B","Loyalty points"),"fr":("Article A","Article B","Points fidélité")}[locale]
            first=round((amount+8.5)*rng.uniform(.25,.7),2)
            add(None,f"{items[0]}   {money(first,locale)}")
            add(None,f"{items[1]}   {money(round(amount+8.5-first,2),locale)}")
            if index%2==0: add(None,f"{items[2]}: {rng.randint(5,400)}")
        if category != "long":
            add(None, f"{labels['subtotal']}: {money(amount+8.5,locale)}")
            add(None, f"{labels['discount']}: {money(8.5,locale)}")
        total_label=labels['total'] if index%3 else {"zh":"合计","en":"Total","fr":"Net à payer"}[locale]
        add("amount", f"{total_label}: {money(amount,locale)}", amount)
        if category != "long": add(None, f"{labels['change']}: {money(5.5,locale)}")
        if index%3==0:
            add("date", f"{labels['date']}: {display_date(date,locale,index%4==0)}", date)
        add("merchant", merchant, merchant)
        if category in ("invoices", "orders") or rng.random() < .35:
            add("invoiceNo", f"{labels['invoice'] if category == 'invoices' else labels['order']}: {reference}", reference)
        if category == "invoices" and rng.random() < .75:
            tax = round(amount * .1, 2)
            add("tax", f"{labels['tax']}: {money(tax,locale)}", tax)
        if category == "long":
            point1 = {"zh": "服务期限为六个月", "en": "The service term is six months", "fr": "La durée du service est de six mois"}[locale]
            point2 = {"zh": "付款截止日为收到通知后十天", "en": "Payment is due within ten days of notice", "fr": "Le paiement est dû dix jours après notification"}[locale]
            add(None, point1); add(None, point2)
            paragraphs={
                "zh":["甲方应在每月五日前提供账单。","双方应保留书面记录，发生争议时先协商。","服务范围包括资料整理和月度报告。","除非另行书面约定，费用按本通知列示。"],
                "en":["The provider issues a statement before the fifth of each month.","Both parties should keep written records and discuss disputes first.","The scope includes document sorting and a monthly report.","Fees follow this notice unless agreed otherwise in writing."],
                "fr":["Le prestataire remet un relevé avant le cinq de chaque mois.","Les parties conservent des traces écrites et discutent d'abord les différends.","Le service comprend le classement et un rapport mensuel.","Les frais suivent cet avis sauf accord écrit contraire."]}[locale]
            for i in range(20):
                if i==10: add(None,"──────── PAGE 2 / 2 ────────")
                add(None,paragraphs[(i+index)%len(paragraphs)])
            summary = {"must": {"zh":["六个月","十天"],"en":["six months","ten days"],"fr":["six mois","dix jours"]}[locale], "must_not": [{"zh": "自动续约", "en": "automatic renewal", "fr": "renouvellement automatique"}[locale], {"zh": "违约金", "en": "penalty fee", "fr": "pénalité"}[locale]]}
        if category in ("receipts", "orders", "invoices"):
            add("category", {"zh": "用途", "en": "Type", "fr": "Type"}[locale] + ": " + dict(CHOICES[locale])[group], group)
    add(None, {"zh": "电话：010-5555-1888 · 二维码见背面", "en": "Tel: 555-0100 · Scan QR for offers", "fr": "Tél : 01 23 45 67 89 · QR au verso"}[locale])
    add(None, {"zh": "感谢惠顾", "en": "Thank you", "fr": "Merci de votre visite"}[locale])
    return lines, vals, summary


def corrupt(text: str, rng: random.Random, difficulty: str) -> tuple[str, list[str]]:
    if difficulty == "clean": return text, []
    tags = []
    lines = text.splitlines()
    if len(lines) > 8:
        at = rng.randrange(3, len(lines)-2)
        lines.insert(at+2, lines.pop(at)); tags.append("column_order")
    if difficulty == "hard" or rng.random() < .5:
        pairs = [("0", "O"), ("1", "l"), ("5", "S"), ("店", "占"), ("票", "栗")]
        a,b = rng.choice(pairs)
        for i,l in enumerate(lines):
            if a in l and rng.random() < .35:
                lines[i] = l.replace(a,b,1); tags.append("confusable"); break
    if difficulty == "hard":
        for i,l in enumerate(lines):
            if re.search(r"\d+[.,]\d\d",l) and rng.random() < .35:
                lines[i] = re.sub(r"(\d),([0-9]{2})",r"\1\2",l, count=1); tags.append("punctuation"); break
        if rng.random() < .5:
            i=rng.randrange(len(lines)); lines[i]=lines[i].replace(" ","",1); tags.append("spacing")
        for i,line in enumerate(lines):
            if "SAMPLE DOCUMENT" in line or "DOCUMENT FICTIF" in line or "样例单据" in line:
                if len(line)>7: lines[i]=line[:7]+line[8:]; tags.append("dropped_character")
                break
    return "\n".join(lines), tags


def render(lines: list[str], locale: str, difficulty: str, rng: random.Random, path: Path) -> None:
    font = ImageFont.truetype(font_for(locale), 27 if locale == "zh" else 25)
    h = min(2200, max(620, 85 + 42*len(lines)))
    page = Image.new("RGB",(980,h),"#fffdf7")
    draw = ImageDraw.Draw(page)
    for i,line in enumerate(lines):
        if 65 + i*42 > h-35: break
        draw.text((52,65+i*42),line[:70],font=font,fill="#222222")
    if difficulty != "clean":
        page = page.rotate(rng.choice([-2,-1,1,2]),expand=True,fillcolor="#d7d2c9")
        w,hh=page.size
        skew=10 if difficulty=="normal" else 25
        # Pillow QUAD 的角顺序是左上、左下、右下、右上。
        quad=(rng.randint(0,skew),rng.randint(0,skew),rng.randint(0,skew),hh-rng.randint(0,skew),
              w-rng.randint(0,skew),hh-rng.randint(0,skew),w-rng.randint(0,skew),rng.randint(0,skew))
        page=page.transform((w,hh),Image.Transform.QUAD,quad,fillcolor="#d7d2c9")
        page = page.filter(ImageFilter.GaussianBlur(.45 if difficulty=="normal" else 1.0))
        overlay = Image.new("RGBA",page.size,(0,0,0,0)); d=ImageDraw.Draw(overlay)
        d.polygon([(0,0),(page.width//5,0),(0,page.height)],fill=(0,0,0,14 if difficulty=="normal" else 28))
        page=Image.alpha_composite(page.convert("RGBA"),overlay).convert("RGB")
        if difficulty=="hard":
            noise=ImageDraw.Draw(page)
            for _ in range(1100):
                x=rng.randrange(w); y=rng.randrange(hh)
                noise.point((x,y),fill=(rng.randrange(150,220),)*3)
    page.save(path,optimize=True)


def generate(root: Path, seed: int) -> dict:
    rng=random.Random(seed)
    root.mkdir(parents=True,exist_ok=True)
    stats={"samples":0,"null_fields":0,"fields":0,"by_category":{}}
    for category, languages in COUNTS.items():
        for locale,n in languages.items():
            for index in range(1,n+1):
                schema=make_schema(category,locale,rng,index)
                lines,base_truth,summary=make_document(category,locale,rng,index,schema)
                for difficulty in DIFFICULTIES:
                    sample_id=f"{category}-{locale}-{index:03}-{difficulty}"
                    folder=root/sample_id; folder.mkdir(exist_ok=True)
                    used_lines=lines[:]
                    truth=base_truth.copy()
                    tags=[]
                    if difficulty == "hard":
                        possible=[j for j,(field,_) in enumerate(used_lines) if field in ("invoiceNo","tax","phone","email","origin","destination","name")]
                        if possible:
                            j=rng.choice(possible); field,_=used_lines.pop(j); truth[field]=None; tags.append(f"missing_{field}")
                    clean_text="\n".join(t for _,t in used_lines)
                    ocr,noise=corrupt(clean_text,rng,difficulty); tags+=noise
                    write_json(folder/"schema.json",schema)
                    write_json(folder/"truth.json",truth)
                    (folder/"ocr.txt").write_text(ocr+"\n",encoding="utf-8")
                    render([t for _,t in used_lines],locale,difficulty,rng,folder/"source.png")
                    write_json(folder/"meta.json",{"id":sample_id,"language":locale,"category":category,"difficulty":difficulty,"seed":seed,"interference":tags})
                    if summary: write_json(folder/"summary_points.json",summary)
                    stats["samples"]+=1; stats["fields"]+=len(truth); stats["null_fields"]+=sum(v is None for v in truth.values()); stats["by_category"][category]=stats["by_category"].get(category,0)+1
    write_json(root/"manifest.json",{"seed":seed,**stats})
    return stats


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",type=Path,default=Path(__file__).resolve().parents[1]/"data")
    parser.add_argument("--seed",type=int,default=20261027)
    a=parser.parse_args()
    print(json.dumps(generate(a.output,a.seed),ensure_ascii=False))
