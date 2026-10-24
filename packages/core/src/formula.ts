// 公式字段（D-188）：数据表里由别的数字字段算出来的值，例如「{price} * {qty}」。
// 只有数字、字段引用 {字段 ID}、+ - * /、括号和负号：解析成一棵小树再计算，不执行任何代码，
// 没有函数、变量、比较和循环。值不存进记录，显示和统计时现算。

export const MAX_FORMULA_LENGTH = 200;

export type FormulaNode =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; field: string }
  | { kind: 'neg'; arg: FormulaNode }
  | { kind: 'op'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode };

export type ParsedFormula =
  { ok: true; node: FormulaNode; refs: string[] } | { ok: false; error: string };

type Token =
  | { t: 'num'; value: number }
  | { t: 'ref'; field: string }
  | { t: '+' | '-' | '*' | '/' | '(' | ')' };

function tokenize(text: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === ' ' || c === '\t') {
      i++;
    } else if ('+-*/()'.includes(c)) {
      tokens.push({ t: c as '+' });
      i++;
    } else if (c === '×') {
      tokens.push({ t: '*' });
      i++;
    } else if (c === '÷') {
      tokens.push({ t: '/' });
      i++;
    } else if (c === '{') {
      const end = text.indexOf('}', i);
      if (end < 0) return 'unclosed {';
      const field = text.slice(i + 1, end).trim();
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(field)) return `bad field id "${field}"`;
      tokens.push({ t: 'ref', field });
      i = end + 1;
    } else if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+|^\d+\.?/.exec(text.slice(i))!;
      const value = Number(m[0]);
      if (!Number.isFinite(value)) return `bad number "${m[0]}"`;
      tokens.push({ t: 'num', value });
      i += m[0].length;
    } else {
      return `unexpected "${c}"`;
    }
  }
  return tokens;
}

/** 解析公式；引用的字段按出现顺序去重列出。 */
export function parseFormula(text: string): ParsedFormula {
  if (text.length > MAX_FORMULA_LENGTH) return { ok: false, error: 'too long' };
  const tokenized = tokenize(text);
  if (typeof tokenized === 'string') return { ok: false, error: tokenized };
  const tokens: Token[] = tokenized;
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];

  // 加减 → 乘除 → 负号 → 数字 / 字段 / 括号。
  function expr(): FormulaNode | string {
    let left = term();
    while (typeof left !== 'string' && (peek()?.t === '+' || peek()?.t === '-')) {
      const op = tokens[pos++]!.t as '+' | '-';
      const right = term();
      if (typeof right === 'string') return right;
      left = { kind: 'op', op, left, right };
    }
    return left;
  }
  function term(): FormulaNode | string {
    let left = unary();
    while (typeof left !== 'string' && (peek()?.t === '*' || peek()?.t === '/')) {
      const op = tokens[pos++]!.t as '*' | '/';
      const right = unary();
      if (typeof right === 'string') return right;
      left = { kind: 'op', op, left, right };
    }
    return left;
  }
  function unary(): FormulaNode | string {
    if (peek()?.t === '-') {
      pos++;
      const arg = unary();
      return typeof arg === 'string' ? arg : { kind: 'neg', arg };
    }
    return atom();
  }
  function atom(): FormulaNode | string {
    const token = tokens[pos++];
    if (!token) return 'unexpected end';
    if (token.t === 'num') return { kind: 'num', value: token.value };
    if (token.t === 'ref') return { kind: 'ref', field: token.field };
    if (token.t === '(') {
      if (++depth > 20) return 'too deeply nested';
      const inner = expr();
      if (typeof inner === 'string') return inner;
      if (tokens[pos++]?.t !== ')') return 'missing )';
      depth--;
      return inner;
    }
    return `unexpected "${token.t}"`;
  }

  const node = expr();
  if (typeof node === 'string') return { ok: false, error: node };
  if (pos < tokens.length) return { ok: false, error: `unexpected "${tokens[pos]!.t}"` };
  const refs: string[] = [];
  const collect = (n: FormulaNode) => {
    if (n.kind === 'ref' && !refs.includes(n.field)) refs.push(n.field);
    else if (n.kind === 'neg') collect(n.arg);
    else if (n.kind === 'op') {
      collect(n.left);
      collect(n.right);
    }
  };
  collect(node);
  if (refs.length === 0) return { ok: false, error: 'no fields' };
  return { ok: true, node, refs };
}

/** 计算；有字段没填、除以 0 或结果不是有限数时返回 undefined（不显示，也不计入统计）。 */
export function evaluateFormula(
  node: FormulaNode,
  valueOf: (field: string) => number | undefined,
): number | undefined {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'ref':
      return valueOf(node.field);
    case 'neg': {
      const v = evaluateFormula(node.arg, valueOf);
      return v === undefined ? undefined : -v;
    }
    case 'op': {
      const a = evaluateFormula(node.left, valueOf);
      const b = evaluateFormula(node.right, valueOf);
      if (a === undefined || b === undefined) return undefined;
      const r =
        node.op === '+'
          ? a + b
          : node.op === '-'
            ? a - b
            : node.op === '*'
              ? a * b
              : b === 0
                ? NaN
                : a / b;
      return Number.isFinite(r) ? r : undefined;
    }
  }
}
