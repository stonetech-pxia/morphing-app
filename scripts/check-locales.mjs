import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// 过渡期可列出缺译而不阻塞；正式启用法语前移除 --allow-missing。
const allowMissing = process.argv.includes('--allow-missing');
const list = process.argv.includes('--list');
const missing = [];
const errors = [];
let total = 0;
let pairs = 0;
const frenchPairs = new Map();
const pairsSource = ts.createSourceFile(
  'french-pairs.ts',
  fs.readFileSync('packages/core/src/french-pairs.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
function collectPairs(node) {
  if (
    ts.isPropertyAssignment(node) &&
    (ts.isStringLiteralLike(node.name) || ts.isIdentifier(node.name)) &&
    ts.isStringLiteralLike(node.initializer)
  )
    frenchPairs.set(node.name.text, node.initializer.text);
  ts.forEachChild(node, collectPairs);
}
collectPairs(pairsSource);
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
    // 「zh ? '中文' : 'English'」这种写法法语界面会显示英文：界面文案要放进文案表（内置规则的 /ai/ 除外，P-037）。
    if (
      !file.includes('/ai/') &&
      ts.isConditionalExpression(node) &&
      /\bzh\b|locale === 'zh'|=== 'zh'/.test(node.condition.getText(source)) &&
      [node.whenTrue, node.whenFalse].some(
        (branch) =>
          (ts.isStringLiteralLike(branch) || ts.isTemplateExpression(branch)) &&
          /[\u3400-\u9fff]/.test(branch.getText(source)),
      )
    )
      errors.push(
        `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: 中英三元式文案，法语会显示英文，改用文案表`,
      );
    if (
      !file.includes('/ai/') &&
      ts.isArrayLiteralExpression(node) &&
      node.elements.length === 2 &&
      node.elements.every(ts.isStringLiteralLike)
    ) {
      const [a, b] = node.elements.map((n) => n.text);
      const isChinese = (s) => /[\u3400-\u9fff]/.test(s);
      const en = isChinese(a) && !isChinese(b) ? b : isChinese(b) && !isChinese(a) ? a : null;
      if (en) {
        pairs++;
        if (!frenchPairs.has(en))
          missing.push(
            `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} (pair: ${en})`,
          );
        else if (placeholders(en) !== placeholders(frenchPairs.get(en)))
          errors.push(`${file}: 名称对的法语占位符不一致`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
// 文案表（packages/core/src/messages/）：三种语言的键要完全一致（TypeScript 也会查），
// 法语不能为空、占位符要和英文一致。
const MESSAGES_DIR = 'packages/core/src/messages';
function tables(lang) {
  const file = path.join(MESSAGES_DIR, `${lang}.ts`);
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found = new Map();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      let init = declaration.initializer;
      while (init && (ts.isSatisfiesExpression(init) || ts.isAsExpression(init)))
        init = init.expression;
      if (!init || !ts.isObjectLiteralExpression(init)) continue;
      const entries = new Map();
      for (const p of init.properties)
        if (ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer))
          entries.set(p.name.getText(source).replace(/['"]/g, ''), {
            text: p.initializer.text,
            line: source.getLineAndCharacterOfPosition(p.getStart()).line + 1,
          });
      found.set(declaration.name.getText(source), { file, entries });
    }
  }
  return found;
}
const [enTables, zhTables, frTables] = ['en', 'zh', 'fr'].map(tables);
for (const [enName, otherName, others, lang] of [
  ['en', 'zh', zhTables, 'zh'],
  ['en', 'fr', frTables, 'fr'],
  ['enSingular', 'frSingular', frTables, 'fr'],
]) {
  const base = enTables.get(enName);
  const other = others.get(otherName);
  if (!base || !other) {
    errors.push(`${MESSAGES_DIR}: 找不到文案表 ${enName} / ${otherName}`);
    continue;
  }
  for (const [key, { text }] of base.entries) {
    if (lang === 'fr') total++;
    const found = other.entries.get(key);
    if (!found) {
      missing.push(`${other.file} (${otherName}.${key})`);
      continue;
    }
    const location = `${other.file}:${found.line}`;
    if (!found.text.trim()) errors.push(`${location}: ${lang === 'fr' ? '法语' : '中文'}文案为空`);
    if (lang === 'fr' && placeholders(text) !== placeholders(found.text))
      errors.push(`${location}: 法语占位符不一致`);
  }
  for (const key of other.entries.keys())
    if (!base.entries.has(key)) errors.push(`${other.file}: ${otherName}.${key} 在英文里没有`);
}
console.log(`本地化检查：${total} 处文案、${pairs} 处名称对，${missing.length} 处待补法语。`);
if (list) missing.forEach((line) => console.log(`${line}: 缺少 fr`));
errors.forEach((line) => console.error(line));
if (errors.length || (!allowMissing && missing.length)) process.exitCode = 1;
