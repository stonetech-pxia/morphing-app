// 从仓库的内设快捷操作导出「按内容推荐」评测用的候选（名字、说明、能接的文件类型）。
// 用法（仓库根目录）：npx tsx tests/local-model-eval/classification/match/export_presets.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { WORKFLOW_PRESETS } from '../../../../packages/core/src/workflows/presets';

// 只取跟文件内容有关的内设快捷操作；按文件类型和个数排的（D-237 已经有）不在这里比。
const CONTENT_PRESETS = ['receipt-archive', 'expense-report', 'sign-return', 'redact-screenshots'];

const accepts = (first: { action: string; params: Record<string, unknown> }) =>
  first.action === 'in.files' && first.params.accept === 'pdf' ? ['pdf'] : ['image'];

const out = CONTENT_PRESETS.map((id) => {
  const preset = WORKFLOW_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`missing preset ${id}`);
  return {
    id,
    name: preset.name,
    description: preset.description,
    accepts: accepts(preset.steps('en')[0]!),
  };
});
writeFileSync(join(import.meta.dirname, 'presets.json'), JSON.stringify(out, null, 2) + '\n');
console.log(out.map((p) => `${p.id} ${p.accepts.join(',')}`).join('\n'));
