// 生成 packages/core/src/ocr-t2s.ts（D-268）：繁体字 → 简体字的单字表，来自 OpenCC（Apache-2.0）的
// TSCharacters.txt 和 STCharacters.txt。只收一对一、而且繁体字本身不是简体里也用的字（例如「乾」「於」「夥」
// 在简体里也有用，表里有它自己就跳过；STCharacters 里当作简体字出现的也跳过），转了不会改坏。
// 用法：node scripts/gen-t2s.mjs <TSCharacters.txt> <STCharacters.txt>
import fs from 'node:fs';

const [tsPath, stPath] = process.argv.slice(2);
if (!tsPath || !stPath)
  throw new Error('usage: node scripts/gen-t2s.mjs TSCharacters.txt STCharacters.txt');
const rows = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [key, values] = l.split('\t');
      return [key, values.split(' ')];
    });
const simplified = new Set(rows(stPath).map(([key]) => key));
let from = '';
let to = '';
for (const [t, options] of rows(tsPath)) {
  if ([...t].length !== 1 || options.includes(t) || simplified.has(t)) continue;
  const s = options[0];
  if ([...s].length !== 1) continue;
  from += t;
  to += s;
}
const out = `// 由 scripts/gen-t2s.mjs 生成，不要手改（D-268）。数据来自 OpenCC（https://github.com/BYVoid/OpenCC，Apache-2.0）。
// 繁体字 → 简体字，两个字符串按位置一一对应（按 code point，个别字在 BMP 之外）。

export const T2S_FROM = ${JSON.stringify(from)};
export const T2S_TO = ${JSON.stringify(to)};
`;
fs.writeFileSync(new URL('../packages/core/src/ocr-t2s.ts', import.meta.url), out);
console.log(`${[...from].length} characters`);
