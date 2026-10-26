// 公式字段（D-188）：数据表里由别的数字字段算出来的值，例如「{price} * {qty}」。
// 只有数字、字段引用 {字段 ID}、+ - * /、括号和负号：解析成一棵小树再计算，不执行任何代码，
// 没有变量和循环。值不存进记录，显示和统计时现算。
// D-246：加一个受限的条件 if(比较, 是的时候, 不是的时候)。比较只能写在 if 的第一项里，只有 > < >= <= =；
// if 算一层括号，嵌套层数和长度的上限不变。
// D-247：日期。日期字段 {due} 和 today 是「日期」，只能放进 days(从, 到)（相差几天，到 − 从）或 if 的比较里，
// 不能加减乘除；公式的结果一定是数字。类型在校验时按字段类型检查（formulaType）。

export const MAX_FORMULA_LENGTH = 200;

export type Comparison = '>' | '<' | '>=' | '<=' | '=';

export type FormulaNode =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; field: string }
  | { kind: 'neg'; arg: FormulaNode }
  | { kind: 'op'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode }
  | { kind: 'today' }
  | { kind: 'days'; from: FormulaNode; to: FormulaNode }
  | {
      kind: 'if';
      cmp: Comparison;
      left: FormulaNode;
      right: FormulaNode;
      then: FormulaNode;
      otherwise: FormulaNode;
    };

export type ParsedFormula =
  { ok: true; node: FormulaNode; refs: string[] } | { ok: false; error: string };

type Token =
  | { t: 'num'; value: number }
  | { t: 'ref'; field: string }
  | { t: 'cmp'; cmp: Comparison }
  | { t: 'if' | 'today' | 'days' }
  | { t: '+' | '-' | '*' | '/' | '(' | ')' | ',' };

/** 公式里认识的词：if（D-246）、today 和 days（D-247）。 */
const WORDS = new Set(['if', 'today', 'days']);

function tokenize(text: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === ' ' || c === '\t') {
      i++;
    } else if ('+-*/(),'.includes(c)) {
      tokens.push({ t: c as '+' });
      i++;
    } else if (c === '，') {
      tokens.push({ t: ',' });
      i++;
    } else if (c === '>' || c === '<') {
      const orEqual = text[i + 1] === '=';
      tokens.push({ t: 'cmp', cmp: `${c}${orEqual ? '=' : ''}` as Comparison });
      i += orEqual ? 2 : 1;
    } else if (c === '≥' || c === '≤') {
      tokens.push({ t: 'cmp', cmp: c === '≥' ? '>=' : '<=' });
      i++;
    } else if (c === '=') {
      tokens.push({ t: 'cmp', cmp: '=' });
      i++;
    } else if (/[a-zA-Z]/.test(c)) {
      const word = /^[a-zA-Z]+/.exec(text.slice(i))![0];
      if (!WORDS.has(word.toLowerCase())) return `unknown word "${word}"`;
      tokens.push({ t: word.toLowerCase() as 'if' | 'today' | 'days' });
      i += word.length;
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
    if (token.t === 'if') return ifCall();
    if (token.t === 'today') return { kind: 'today' };
    if (token.t === 'days') return daysCall();
    return `unexpected "${token.t === 'cmp' ? token.cmp : token.t}"`;
  }
  // days(从, 到)：两个日期相差几天。
  function daysCall(): FormulaNode | string {
    if (tokens[pos++]?.t !== '(') return 'days needs ( after it';
    if (++depth > 20) return 'too deeply nested';
    const from = expr();
    if (typeof from === 'string') return from;
    if (tokens[pos++]?.t !== ',') return 'days needs two dates';
    const to = expr();
    if (typeof to === 'string') return to;
    if (tokens[pos++]?.t !== ')') return 'missing )';
    depth--;
    return { kind: 'days', from, to };
  }
  // if(比较, 是的时候, 不是的时候)：比较是「式子 运算符 式子」，只能出现在这里。
  function ifCall(): FormulaNode | string {
    if (tokens[pos++]?.t !== '(') return 'if needs ( after it';
    if (++depth > 20) return 'too deeply nested';
    const left = expr();
    if (typeof left === 'string') return left;
    const cmp = tokens[pos++];
    if (cmp?.t !== 'cmp') return 'if needs a comparison (> < >= <= =) first';
    const right = expr();
    if (typeof right === 'string') return right;
    if (tokens[pos++]?.t !== ',') return 'if needs a comma after the comparison';
    const then = expr();
    if (typeof then === 'string') return then;
    if (tokens[pos++]?.t !== ',') return 'if needs three parts';
    const otherwise = expr();
    if (typeof otherwise === 'string') return otherwise;
    if (tokens[pos++]?.t !== ')') return 'missing )';
    depth--;
    return { kind: 'if', cmp: cmp.cmp, left, right, then, otherwise };
  }

  const node = expr();
  if (typeof node === 'string') return { ok: false, error: node };
  if (pos < tokens.length) {
    const extra = tokens[pos]!;
    return { ok: false, error: `unexpected "${extra.t === 'cmp' ? extra.cmp : extra.t}"` };
  }
  const refs: string[] = [];
  const collect = (n: FormulaNode) => {
    if (n.kind === 'ref' && !refs.includes(n.field)) refs.push(n.field);
    else if (n.kind === 'neg') collect(n.arg);
    else if (n.kind === 'op') {
      collect(n.left);
      collect(n.right);
    } else if (n.kind === 'if') {
      for (const part of [n.left, n.right, n.then, n.otherwise]) collect(part);
    } else if (n.kind === 'days') {
      collect(n.from);
      collect(n.to);
    }
  };
  collect(node);
  if (refs.length === 0) return { ok: false, error: 'no fields' };
  return { ok: true, node, refs };
}

export type FormulaType = 'number' | 'date';

/**
 * 公式的类型（D-247）：日期只能进 days() 和比较，加减乘除、负号和 if 的两个结果都要是数字。
 * typeOf 给出字段的类型（不能用的字段返回 null）；返回值类型，或者一句说明哪里不对。
 */
export function formulaType(
  node: FormulaNode,
  typeOf: (field: string) => FormulaType | null,
): FormulaType | { error: string } {
  const need = (n: FormulaNode, want: FormulaType, where: string): { error: string } | null => {
    const got = formulaType(n, typeOf);
    if (typeof got !== 'string') return got;
    return got === want ? null : { error: `${where} needs a ${want}, not a ${got}` };
  };
  switch (node.kind) {
    case 'num':
      return 'number';
    case 'today':
      return 'date';
    case 'ref':
      return typeOf(node.field) ?? { error: `${node.field} can't be used in a formula` };
    case 'neg':
      return need(node.arg, 'number', 'a minus sign') ?? 'number';
    case 'op':
      return need(node.left, 'number', node.op) ?? need(node.right, 'number', node.op) ?? 'number';
    case 'days':
      return need(node.from, 'date', 'days()') ?? need(node.to, 'date', 'days()') ?? 'number';
    case 'if': {
      const left = formulaType(node.left, typeOf);
      if (typeof left !== 'string') return left;
      return (
        need(node.right, left, 'the comparison') ??
        need(node.then, 'number', 'if') ??
        need(node.otherwise, 'number', 'if') ??
        'number'
      );
    }
  }
}

/** 本地日期 YYYY-MM-DD → 天数（按 UTC 算，不受夏令时影响）；不是日期时为 undefined。 */
export function dayNumber(date: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : undefined;
}

/**
 * 计算；有字段没填、除以 0 或结果不是有限数时返回 undefined（不显示，也不计入统计）。
 * 日期字段由 valueOf 给出天数（dayNumber）；today 是今天的天数，没给时用到 today 的公式没有值。
 */
export function evaluateFormula(
  node: FormulaNode,
  valueOf: (field: string) => number | undefined,
  today?: number,
): number | undefined {
  const at = (n: FormulaNode) => evaluateFormula(n, valueOf, today);
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'today':
      return today;
    case 'days': {
      const from = at(node.from);
      const to = at(node.to);
      return from === undefined || to === undefined ? undefined : to - from;
    }
    case 'ref':
      return valueOf(node.field);
    case 'neg': {
      const v = at(node.arg);
      return v === undefined ? undefined : -v;
    }
    case 'op': {
      const a = at(node.left);
      const b = at(node.right);
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
    case 'if': {
      // 比较的两边有一个没有值，整个公式就没有值（不猜是哪一边）。
      const a = at(node.left);
      const b = at(node.right);
      if (a === undefined || b === undefined) return undefined;
      return at(compare(a, node.cmp, b) ? node.then : node.otherwise);
    }
  }
}

/** 相等允许极小的误差（0.1 + 0.2 = 0.3）。 */
function compare(a: number, cmp: Comparison, b: number): boolean {
  const same = Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  switch (cmp) {
    case '=':
      return same;
    case '>':
      return a > b && !same;
    case '<':
      return a < b && !same;
    case '>=':
      return a > b || same;
    case '<=':
      return a < b || same;
  }
}
