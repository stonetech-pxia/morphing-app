# Local structured field extraction re-test

The scripts here read only synthetic OCR text and field schemas. Model weights, caches, per-case outputs and measurement reports go in `../results/` and are not committed. The results cannot replace real OCR or phone tests.

First install the npm dependencies at the repository root, then generate the two shared candidate sets:

```bash
npx tsx tests/local-model-eval/results/export_prefill_eval.ts
npx tsx tests/local-model-eval/prefill/evaluate_diverse.ts
```

In separate, isolated Python environments, install `psutil` (needed to run the models), plus GLiNER2 (`gliner2`, `torch`, `transformers`) or UIE (Python 3.11, `paddlenlp` 2.6.1, `paddlepaddle` 2.6.2). UIE's old Taskflow static model cannot be used directly with Paddle 3.x. The reranker also needs `transformers` and `torch`. Re-test with pinned model versions and eval data; the exact versions, hashes and results are in the handoff report outside the repository.

```bash
# Run from the repository root. UIE runs Chinese, English and French separately to match schema_lang.
python tests/local-model-eval/structured/run_structured.py gliner2.5-multi
python tests/local-model-eval/structured/run_structured.py uie-m-base --lang zh
python tests/local-model-eval/structured/run_structured.py uie-m-base --lang en
python tests/local-model-eval/structured/run_structured.py uie-m-base --lang fr
python tests/local-model-eval/structured/score_structured.py

python tests/local-model-eval/structured/evaluate_diverse.py gliner
python tests/local-model-eval/structured/evaluate_diverse.py uie --lang zh
python tests/local-model-eval/structured/evaluate_diverse.py uie --lang en
python tests/local-model-eval/structured/evaluate_diverse.py uie --lang fr
python tests/local-model-eval/structured/rerank_pilot.py
```

`run_structured.py` and `score_structured.py` keep the old pairs2 convention of mapping to the highest-scoring source-text span. `evaluate_diverse.py` supports each file having its own fields. `rerank_pilot.py` reads GLiNER2's per-case output and reranks the top five spans with `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` at a pinned revision. Each script's output stays in the ignored `../results/`. `PPNLP_HOME` can point to an existing PaddleNLP cache to avoid downloading more than 1 GB of weights again.
