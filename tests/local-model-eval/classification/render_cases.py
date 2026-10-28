"""将人工编写的分类文字渲染为原生 OCR 复测用图片和纯文本文件。"""
from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
from generate_data import font_for  # noqa: E402


def lines_for(text: str, lang: str) -> list[str]:
    if not text:
        return [""]
    return textwrap.wrap(text, width=29 if lang == "zh" else 57,
                         break_long_words=True, break_on_hyphens=False)


def main() -> None:
    cases = [json.loads(line) for line in (HERE / "cases.jsonl").read_text(encoding="utf-8").splitlines() if line]
    images = HERE / "images"
    files = HERE / "files"
    images.mkdir(exist_ok=True)
    files.mkdir(exist_ok=True)
    for case in cases:
        lines = lines_for(case["text"], case["lang"])
        height = max(420, 110 + len(lines) * 51)
        page = Image.new("RGB", (1000, height), "#fffefb")
        draw = ImageDraw.Draw(page)
        font = ImageFont.truetype(font_for(case["lang"]), 30)
        for i, line in enumerate(lines):
            draw.text((55, 60 + i * 51), line, font=font, fill="#171717")
        page.save(images / f"{case['id']}.png", optimize=True)
        (files / f"{case['id']}.txt").write_text(case["text"] + "\n", encoding="utf-8")
    print("rendered", len(cases), "images and text files")


if __name__ == "__main__":
    main()
