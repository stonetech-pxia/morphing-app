# PDF → Word regression suite

Every fix to the PDF/scan → Word converter gets one page here plus a few assertions about what the converted Word file must look like. Re-running the whole suite takes seconds, so a converter change can be checked for regressions without re-converting the large baseline corpora.

Each page in `pdfs/<suite>.pdf` is one case. The runner converts every page with the real app action `OCR_IMPLS['ocr.toWord']` (apps/mobile/src/runtime/actions/ocr.ts). Pages are rendered by the app's own `pdfview` page (PDF.js) in headless Chrome, the same way `pdf.toImages` does it on the phone (long side 2000, JPEG 0.88). Native PDF drawings also go through that page. Only OCR is replayed: `fixtures/<suite>/<case>.json` holds the PP-OCR lines and layout regions recorded for that page, so a normal run needs no models.

## Run

From the repository root:

```bash
npx tsx tests/word-regression/run.ts
```

- `--only <case or suite>[,…]` runs a subset.
- `--render` also renders each docx with LibreOffice and writes `.out/index.html`: the source page next to the Word output, with the failed assertions. Use it to look at what changed, not only at what the assertions cover.
- `--record` re-runs PP-OCR and the layout model and rewrites the fixtures (needed after adding a page or changing its source, or when the OCR models change).

The output goes to `tests/word-regression/.out/` (ignored by git). The exit code is 1 when any case fails that is not marked `knownFailure`.

Every case also runs one generic check: the words OCR recognized are still in the Word file (recall ≥ 0.97) and are not repeated (extra ≤ 2%). Lost or duplicated text is the most damaging converter failure, and this catches it on every page whatever the case was written for.

## External tools

Outside the repository, with defaults for the founder's Mac (override with environment variables):

| Needed for | Default                                                    | Variable                                                                      |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| every run  | Google Chrome in /Applications                             | `WORD_REGRESSION_CHROME`                                                      |
| every run  | playwright in the Codex runtime                            | `WORD_REGRESSION_PLAYWRIGHT` (directory containing `node_modules/playwright`) |
| every run  | pdfview pack files (pdf.js `build/`, `cmaps/`, …)          | `WORD_REGRESSION_PDFJS`                                                       |
| `--record` | PP-OCR det/rec/dictionary, layout_S_fp16, onnxruntime-node | `WORD_REGRESSION_DET`, `_REC`, `_DICT`, `_LAYOUT`, `_ORT`                     |
| `--render` | LibreOffice `soffice`, poppler `pdftoppm`                  | `WORD_REGRESSION_SOFFICE`, `WORD_REGRESSION_PDFTOPPM`                         |

The models must be the ones the app downloads (their SHA-256 is in `packages/core/src/packs.ts`).

## Add a case for a new fix

1. Make a single page that shows the problem and put it in `pages/<suite>/NN-<case-id>.<ext>`, numbered after the last page of that suite:
   - `.html`: printed by Chrome into a digital PDF page (text layer and vector rules). Set the paper with `@page`.
   - `.scan.html`: printed, then rasterized at 200 dpi, rotated 0.6° and given light noise; only the image goes into the PDF, like a scan.
   - `.pdf`: the first page is copied. Use only public-domain or openly licensed pages and note the source in `pages/SOURCES.md`.
   - `.jpg` / `.png`: a photo or scan filling the page.
     Synthetic pages are preferred: no personal data, no licence questions, and the content can be shaped to hit exactly the case.
2. Rebuild the PDF: `npx tsx tests/word-regression/build-pdfs.ts <suite>`.
3. Add the case to `cases/<suite>.ts` (register a new suite file in `cases.ts`) with the fix it guards (commit or D-number), one sentence on what used to go wrong, and assertions from `lib/checks.ts` (`order`, `together`, `apart`, `times`, `table`, `notInTable`, `noTables`, `images`, `sideBySide`, `picturesInRows`, `aligned`, `heading`, `listItem`, or `custom`).
4. Record OCR for the new page: `npx tsx tests/word-regression/run.ts --only <case-id> --record`.
5. Check that the case fails on the code before the fix and passes after it, and look at it once with `--render`.

Suites group the pages by theme so a failure points at the area: `text-flow` (paragraphs, columns, reading order, headings, lists), `tables`, `forms` (labels, fields, boxes), `graphics` (figures, native drawings, backgrounds), `geometry` (paper size, margins, rotation, blank pages), `languages` (French, German, accents, CJK).

A case that currently fails and is waiting for a fix is marked `knownFailure: '<why>'`; the runner reports it without failing, and says so when it starts passing.
