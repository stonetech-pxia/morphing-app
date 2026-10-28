// 只读取仓库里的 Morph 规则；只把结果写到评测目录（已 gitignore）。
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractFirst } from '../../../packages/core/src/text-rules.ts';

const root = resolve(import.meta.dirname, '..');
const data = join(root, 'data');
const rows = [];
for (const name of readdirSync(data).sort()) {
  const dir = join(data, name);
  let meta;
  try { meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')); } catch { continue; }
  const schema = JSON.parse(readFileSync(join(dir, 'schema.json'), 'utf8'));
  const ocr = readFileSync(join(dir, 'ocr.txt'), 'utf8');
  const output = {};
  for (const field of schema.fields) {
    if (!['amount', 'date', 'invoiceNo'].includes(field.id)) continue;
    const value = extractFirst(ocr, field.id === 'invoiceNo' ? 'invoiceNo' : field.id, meta.language);
    output[field.id] = field.type === 'money' && value !== null ? Number(value) : value;
  }
  rows.push({ sample_id: name, model: 'morph-rules', mode: 'rules', output: JSON.stringify(output) });
}
mkdirSync(join(root, 'results'), {recursive: true});
writeFileSync(join(root, 'results', 'morph-rules.jsonl'), rows.map(x => JSON.stringify(x)).join('\n')+'\n');
console.log(rows.length, 'baseline samples');
