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

字段含义对照使用 `../prefill/field_meanings.json`，每个字段只说明用户想记录什么，不包含真值。`evaluate_meaning.py` 在同一 OCR 文本上比较短字段名、完整说明、字段名加说明；`evaluate_uie_candidates.py` 把代码找到的每个日期／金额候选单独交给 UIE，再比较模型给各候选的提取分数：

```bash
python tests/local-model-eval/structured/evaluate_meaning.py uie --lang zh
python tests/local-model-eval/structured/evaluate_meaning.py uie --lang en
python tests/local-model-eval/structured/evaluate_meaning.py uie --lang fr
python tests/local-model-eval/structured/evaluate_meaning.py gliner

python tests/local-model-eval/structured/evaluate_uie_candidates.py --lang zh
python tests/local-model-eval/structured/evaluate_uie_candidates.py --lang en
python tests/local-model-eval/structured/evaluate_uie_candidates.py --lang fr
# 将字段名统一改成“日期／金额”，单独看含义说明的作用：
python tests/local-model-eval/structured/evaluate_uie_candidates.py --lang zh --mode-set generic
python tests/local-model-eval/structured/evaluate_uie_candidates.py --lang en --mode-set generic
python tests/local-model-eval/structured/evaluate_uie_candidates.py --lang fr --mode-set generic
```

逐候选 UIE 评分来自不同文本片段，分数未经过跨片段校准；本实验只是探索性对照。日期原文能对应 DMY 和 MDY 两种有效日期时，结果单列为来源命中但顺序未定，不自动填入。

独立样本复测：`heldout_pairs.jsonl` 是先写定再跑模型的 15 组“确认第一张、只评第二张”样本；`heldout_absence_pairs.jsonl` 是另写的 12 组空目标压力样本。两个结果分别统计，不能把压力样本占比当成真实使用分布。脚本只比较日期和金额；规则／记忆与整页 UIE、逐候选 UIE 读同一份后续文字和同一组代码候选。

```bash
npx tsx tests/local-model-eval/prefill/evaluate_heldout.ts
npx tsx tests/local-model-eval/prefill/evaluate_heldout.ts --absence
python tests/local-model-eval/structured/evaluate_heldout.py --lang zh
python tests/local-model-eval/structured/evaluate_heldout.py --lang en
python tests/local-model-eval/structured/evaluate_heldout.py --lang fr
python tests/local-model-eval/structured/evaluate_heldout.py --lang zh --absence
python tests/local-model-eval/structured/evaluate_heldout.py --lang en --absence
python tests/local-model-eval/structured/evaluate_heldout.py --lang fr --absence
```

逐条输出在忽略的 `../results/structured_eval/heldout*.json`。原始短字段名和逐候选片段规则保持不变；当前没有可靠的空目标判定，结果不能用于自动填写上线判断。

`run_structured.py` 与 `score_structured.py` 沿用旧 pairs2 的最高分原文片段映射口径；`evaluate_diverse.py` 支持每份文件自有字段。`rerank_pilot.py` 读取 GLiNER2 的逐条输出，使用固定 revision 的 `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` 对最高五个片段重排。各脚本的输出留在忽略的 `../results/`。`PPNLP_HOME` 可指向现有 PaddleNLP 缓存，以免重复下载 1 GB 以上权重。
