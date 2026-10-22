// 扫描 node_modules 中所有已安装包的 license 字段，发现与 AGPL-3.0 不兼容或未知的许可证时退出码为 1。
// 用法：npm run check:licenses
import fs from 'node:fs';
import path from 'node:path';

// 与 AGPL-3.0 兼容的许可证（SPDX 表达式原样匹配）。新增条目前请确认兼容性，并在 docs/DECISIONS.md 记录。
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  '0BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'Unlicense',
  'Python-2.0',
  'MPL-2.0',
  'AGPL-3.0-only',
  'MIT AND Apache-2.0',
  '(MIT AND Zlib)', // pako（pdf-lib 的依赖）：Zlib 为宽松许可证，与 GPL 兼容
  'MIT AND OFL-1.1', // @expo-google-fonts/sora、karla：代码 MIT，字体文件 OFL-1.1（字体可随任何软件分发）
  '(MIT OR Apache-2.0)',
  '(MIT OR CC0-1.0)',
  '(BSD-2-Clause OR MIT OR Apache-2.0)',
  '(BSD-3-Clause OR GPL-2.0)', // node-forge：按 BSD-3-Clause 使用
]);

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

const problems = [];
const seen = new Set();

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const pkgDir = path.join(dir, name);
    if (name.startsWith('@')) {
      walk(pkgDir);
      continue;
    }
    const manifest = path.join(pkgDir, 'package.json');
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      const id = `${pkg.name}@${pkg.version}`;
      const license = licenseOf(pkg);
      if (!seen.has(id) && !ALLOWED.has(license)) problems.push(`${id}: ${license}`);
      seen.add(id);
    }
    walk(path.join(pkgDir, 'node_modules'));
  }
}

walk('node_modules');

if (problems.length > 0) {
  console.error('以下依赖的许可证未在允许列表中，需要人工确认与 AGPL-3.0 的兼容性：');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`已检查 ${seen.size} 个依赖，许可证均在允许列表中。`);
