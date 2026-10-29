# 用户确认值 → 原文标签：纯规则评测

`evaluate_learned_label.ts` 不加载或调用模型，也不修改 App 的预填逻辑。它只使用现有日期／金额候选解析器和候选前方标签提取器。

第一张由用户确认的值只在规范化后对应**唯一原文位置**、且该位置的标签也唯一时学习。第二张按学到的原文标签寻找候选，不按用户字段名搜索；标签不存在、重复、值在两栏中无法配对或日期顺序不明时留空。同一组样本只从第一张学习一次，不从后续真值继续学习。不同组的记忆彼此隔离。

```bash
npx tsx tests/local-model-eval/prefill/evaluate_learned_label.ts
npx tsx tests/local-model-eval/prefill/evaluate_learned_label.ts --dataset source_label_pairs
npx tsx tests/local-model-eval/prefill/evaluate_learned_label.ts --dataset stacked_label_cases --assert-stacked
```

输出的逐字段结果留在忽略的 `../results/learned_label_eval.json`。默认运行 `pairs`、`pairs2`、三批旧 heldout、`source_label_pairs` 和两栏回归样本。`source_label_pairs` 让用户字段名与原文标签从第一张开始就不同，并包含第一张值重复、下一张标签缺失的情况。脚本也在相同文件上报告现有规则和现有版式记忆，便于对照。

这些都是合成文字。脚本不处理任意文字字段、真实 OCR 行框、文件相似度识别或跨文件组记忆冲突；结果不能当作手机端或真实文件的准确率。
