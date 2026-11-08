# Local model eval fixtures

This directory holds fictional Chinese, English and French images together with simulated OCR, field schemas, ground truth and eval scripts. `data/` has 477 cases (159 base documents × clean/normal/hard). Claude Code can use them to call Morph Vision on a simulator or an authorized real device, then hand the real OCR output to a candidate model. The image itself is not a text input to the model. Measurement results, handoff reports, model weights and inference tools are not checked in.

## Data and limits

- `data/<sample>/source.png`: the phone OCR input. `ocr.txt`: synthetic simulated OCR, for the desktop baseline only.
- `meta.json`: language, category, difficulty. `schema.json`: the fields to fill. `truth.json`: the expected values.
- The data is produced by `scripts/generate_data.py` with a fixed seed, but fonts differ across platforms and change the pixels, so **the committed PNGs are the baseline for re-testing**. The samples contain repeated layouts and blunt category hints, so their classification scores must not be used to claim accuracy on real photos.
- Real user files, recognized text or user records are never uploaded to a cloud AI. Native test results go to side-session-notes outside the repository.

## Desktop re-run

Run from this directory:

```bash
python -m pip install -r requirements.txt
python scripts/test_metrics.py
python scripts/download_models.py qwen35-08b
MORPH_LLAMA_SERVER_BIN=/absolute/path/to/llama-server python scripts/run_eval.py --model qwen35-08b --backend cpu --mode schema --prompt shared --category receipts --difficulty clean
python scripts/score.py --help
```

The scripts only start and stop the `llama-server` they created. The default port is 8091 and can be changed with `MORPH_EVAL_PORT`. The download script verifies the pinned revision and SHA-256 from `models.json`. `capture_env.py` records the run environment into the ignored `results/`. `rules_baseline.mjs` imports its rules from `packages/core/src/text-rules.ts` in the repository. Node must support TypeScript type stripping.

For phone tests, record separately: OCR accuracy, classification/field correctness, wrongly filled empty values, peak memory, time taken, cancellation and low-memory recovery. A Windows working set cannot stand in for phone RAM, and simulated-OCR scores cannot stand in for real ML Kit / Vision scores. Further details are in the Claude Code handoff document, delivered separately and not kept in Git.
