import type { z } from 'zod';

import { ID_MESSAGE } from './schema-primitives';

// 校验问题的文字（发给模型修正，D10）。z.union 全部分支都不合格时只报 Invalid input，模型不知道哪里错：
// 这里展开到最接近的分支，报出具体的路径和问题。

type Issue = z.ZodError['issues'][number];

interface Line {
  path: PropertyKey[];
  code: string;
  message: string;
  /** 字面量不对时可选的值。 */
  values?: readonly unknown[];
}

/** 这一支离输入有多远：类型都不对的最远，判别的字面量（kind、every）不对、多了键的次之，然后看问题个数。 */
function distance(lines: readonly Line[], depth: number): number {
  let score = lines.length;
  for (const line of lines) {
    if (line.code === 'invalid_type' && line.path.length === depth) score += 1000;
    if (line.code === 'invalid_value' && line.path.length === depth + 1) score += 100;
    if (line.code === 'unrecognized_keys' && line.path.length === depth) score += 100;
  }
  return score;
}

const samePath = (a: Line, b: Line) => a.path.join('.') === b.path.join('.');

/** 每一支都说这个键不对（do 拼错）时，把各支要的值合起来：只说第一支要的 "create" 会把模型带错。 */
function withAllValues(line: Line, branches: readonly Line[][]): Line {
  if (!line.values) return line;
  const values = branches.flatMap((lines) =>
    lines.filter((l) => l.values && samePath(l, line)).flatMap((l) => l.values!),
  );
  const options = [...new Set(values)].map((v) => JSON.stringify(v)).join('|');
  return { ...line, values, message: `Invalid option: expected one of ${options}` };
}

function expand(issue: Issue, base: readonly PropertyKey[]): Line[] {
  const path = [...base, ...issue.path];
  if (issue.code === 'invalid_value')
    return [{ path, code: issue.code, message: issue.message, values: issue.values }];
  if (issue.code !== 'invalid_union')
    return [{ path, code: issue.code ?? 'custom', message: issue.message }];
  // 判别的键（look、op、type）不是任何一个可选的值时没有分支可以展开。
  if (issue.errors.length === 0) {
    const key = issue.discriminator;
    return [{ path, code: issue.code, message: key ? `not a valid ${key}` : issue.message }];
  }
  const branches = issue.errors.map((branch) => branch.flatMap((i) => expand(i, path)));
  const best = branches.reduce((a, b) =>
    distance(b, path.length) < distance(a, path.length) ? b : a,
  );
  return best.map((line) => withAllValues(line, branches));
}

/** 记录块的这些地方写的是字段 ID，模型常写成要显示的文字。 */
const FIELD_ID_PLACE = /(?:^|\.)show\.(title|subtitles|trailing)(?:\.\d+)?$/;

function text({ path, message }: Line): string {
  const where = path.map(String).join('.');
  const place = message === ID_MESSAGE ? FIELD_ID_PLACE.exec(where) : null;
  const what = place
    ? `record blocks' show.${place[1]} is a field id, use a header block or a page title for text`
    : message;
  return `${where || '(root)'}: ${what}`;
}

/** 一个 zod 错误的每个问题一行：「路径: 问题」。 */
export function issueLines(error: z.ZodError): string[] {
  return error.issues.flatMap((issue) => expand(issue, [])).map(text);
}
