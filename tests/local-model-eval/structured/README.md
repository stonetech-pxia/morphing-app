# 本地结构化字段提取复测

这里的脚本只读取合成 OCR 文字和字段 schema。模型权重、缓存、逐条输出及测量报告放在 `../results/`，不提交。结果不能代替真实 OCR 或手机端测试。

先在仓库根目录安装 npm 依赖，然后生成两组共享候选：

```bash
npx tsx tests/local-model-eval/results/export_prefill_eval.ts
npx tsx tests/local-model-eval/prefill/evaluate_diverse.ts
```

在各自隔离的 Python 环境中安装模型运行所需的 `psutil`，以及 GLiNER2（`gliner2`、`torch`、`transformers`）或 UIE（Python 3.11、`paddlenlp` 2.6.1、`paddlepaddle` 2.6.2）。UIE 的旧 Taskflow 静态模型不能直接用 Paddle 3.x。重排器还需要 `transformers` 和 `torch`。以固定版本的模型与评测数据复测，具体版本、哈希及结果见仓库外交接报告。

```bash
# 在仓库根目录执行。UIE 的中、英、法分开运行，以匹配 schema_lang。
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

`run_structured.py` 与 `score_structured.py` 沿用旧 pairs2 的最高分原文片段映射口径；`evaluate_diverse.py` 支持每份文件自有字段。`rerank_pilot.py` 读取 GLiNER2 的逐条输出，使用固定 revision 的 `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` 对最高五个片段重排。各脚本的输出留在忽略的 `../results/`。`PPNLP_HOME` 可指向现有 PaddleNLP 缓存，以免重复下载 1 GB 以上权重。
