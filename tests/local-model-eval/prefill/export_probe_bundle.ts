// 给模拟器探针用：把 data/ 里 477 份 ocr.txt 打成一个 JSON（id、语言、文字），放到 App 里临时读。
// 用法（仓库根目录）：npx tsx tests/local-model-eval/prefill/export_probe_bundle.ts <输出路径>
// 输出文件只给探针用，不要提交。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const data = join(import.meta.dirname, '..', 'data');
const out: { id: string; lang: string; text: string }[] = [];
for (const name of readdirSync(data).sort()) {
  try {
    const meta = JSON.parse(readFileSync(join(data, name, 'meta.json'), 'utf8'));
    out.push({
      id: name,
      lang: meta.language,
      text: readFileSync(join(data, name, 'ocr.txt'), 'utf8'),
    });
  } catch {
    // manifest.json 之类不是样本。
  }
}
writeFileSync(process.argv[2]!, JSON.stringify(out));
console.log(out.length, 'samples');
