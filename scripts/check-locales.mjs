import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// 过渡期可列出缺译而不阻塞；正式启用法语前移除 --allow-missing。
const allowMissing = process.argv.includes('--allow-missing');
const list = process.argv.includes('--list');
const missing = [];
const errors = [];
let total = 0;
function filesIn(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (
      ['node_modules', 'dist', 'ios', 'android', '.expo', 'modules', '.claude'].includes(entry.name)
    )
      return [];
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return filesIn(file);
    return /\.(ts|tsx)$/.test(file) && !/(?:test|fixture|eval-cases)/.test(file) ? [file] : [];
  });
}
const placeholders = (value) =>
  [...new Set([...value.matchAll(/\{([a-zA-Z_]\w*)(?::[^}]+)?\}/g)].map((m) => m[1]))]
    .sort()
    .join(',');
for (const file of [...filesIn('packages'), ...filesIn('apps')]) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map(
        node.properties
          .filter(ts.isPropertyAssignment)
          .map((p) => [p.name.getText(source).replace(/['"]/g, ''), p.initializer]),
      );
      if (props.has('en') && props.has('zh')) {
        total++;
        const location = `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        const en = props.get('en');
        const fr = props.get('fr');
        if (!fr) missing.push(location);
        else if (ts.isStringLiteralLike(en) && ts.isStringLiteralLike(fr)) {
          if (!fr.text.trim()) errors.push(`${location}: 法语文案为空`);
          if (placeholders(en.text) !== placeholders(fr.text))
            errors.push(`${location}: 法语占位符不一致`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
console.log(`本地化检查：${total} 处文案，${missing.length} 处待补法语。`);
if (list) missing.forEach((line) => console.log(`${line}: 缺少 fr`));
errors.forEach((line) => console.error(line));
if (errors.length || (!allowMissing && missing.length)) process.exitCode = 1;
