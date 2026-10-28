// 用 App 里同一份代码算每段文字的可读性（text-classify.ts）和规则命中（text-rules.ts），给 Python 评测用。
// 用法（仓库根目录）：npx tsx tests/local-model-eval/classification/ts_features.ts <cases.jsonl>
// 输出到标准输出，每行 {"id","readability","rules"}；文字本身不输出。
import { readFileSync } from 'node:fs';

import { textReadability } from '../../../packages/core/src/text-classify';
import { extractFirst, type TextRule } from '../../../packages/core/src/text-rules';

const RULES: TextRule[] = ['amount', 'date', 'invoiceNo', 'phone', 'email', 'url'];

for (const line of readFileSync(process.argv[2]!, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const row = JSON.parse(line) as { id: string; lang: 'zh' | 'en' | 'fr'; text: string };
  const rules = Object.fromEntries(
    RULES.map((rule) => [rule, extractFirst(row.text, rule, row.lang) !== null]),
  );
  console.log(JSON.stringify({ id: row.id, readability: textReadability(row.text), rules }));
}
