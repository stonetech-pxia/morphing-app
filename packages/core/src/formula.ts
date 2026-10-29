// 公式字段（D-188）：数据表里由别的数字字段算出来的值，例如「{price} * {qty}」。
// 只有数字、字段引用 {字段 ID}、+ - * /、括号和负号：解析成一棵小树再计算，不执行任何代码，
// 没有变量和循环。值不存进记录，显示和统计时现算。
// D-246：加一个受限的条件 if(比较, 是的时候, 不是的时候)。比较只能写在 if 的第一项里，只有 > < >= <= =；
// if 算一层括号，嵌套层数和长度的上限不变。
// D-247：日期。日期字段 {due} 和 today 是「日期」，只能放进 days(从, 到)（相差几天，到 − 从）或 if 的比较里，
// 不能加减乘除；公式的结果一定是数字。类型在校验时按字段类型检查（formulaType）。
// D-280：函数 min、max、round、abs；时间 {time} 和日期时间 {datetime} 只能放进 hours(从, 到) / minutes(从, 到)
// 或 if 的比较里（时间跨午夜时自动加 24 小时），日期时间也能放进 days()；时长当作分钟数。
// D-281：公式可以引用别的公式字段（检查时挡住循环引用），最长 500 字。

export const MAX_FORMULA_LENGTH = 500;

export type Comparison = '>' | '<' | '>=' | '<=' | '=';

export type FormulaNode =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; field: string }
  | { kind: 'neg'; arg: FormulaNode }
  | { kind: 'op'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode }
  | { kind: 'today' }
  | { kind: 'days'; from: FormulaNode; to: FormulaNode }
  | { kind: 'fn'; fn: FormulaFunction; args: FormulaNode[] }
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
  | { t: 'fn'; fn: FormulaFunction }
  | { t: '+' | '-' | '*' | '/' | '(' | ')' | ',' };

/** D-280 的函数：参数个数 [最少, 最多]。 */
const FUNCTIONS = {
  min: [2, 10],
  max: [2, 10],
  round: [1, 2],
  abs: [1, 1],
  hours: [2, 2],
  minutes: [2, 2],
} as const;
export type FormulaFunction = keyof typeof FUNCTIONS;
const isFunction = (word: string): word is FormulaFunction => Object.hasOwn(FUNCTIONS, word);

/** 公式里认识的词：if（D-246）、today 和 days（D-247），以及 FUNCTIONS（D-280）。 */
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
      const lower = word.toLowerCase();
      if (isFunction(lower)) tokens.push({ t: 'fn', fn: lower });
      else if (WORDS.has(lower)) tokens.push({ t: lower as 'if' | 'today' | 'days' });
      else return `unknown word "${word}"`;
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
    if (token.t === 'fn') return fnCall(token.fn);
    return `unexpected "${tokenText(token)}"`;
  }
  // min / max / round / abs / hours / minutes：参数用逗号隔开，个数按 FUNCTIONS。
  function fnCall(fn: FormulaFunction): FormulaNode | string {
    if (tokens[pos++]?.t !== '(') return `${fn} needs ( after it`;
    if (++depth > 20) return 'too deeply nested';
    const args: FormulaNode[] = [];
    for (;;) {
      const arg = expr();
      if (typeof arg === 'string') return arg;
      args.push(arg);
      const next = tokens[pos++];
      if (next?.t === ')') break;
      if (next?.t !== ',') return 'missing )';
    }
    depth--;
    const [least, most] = FUNCTIONS[fn];
    if (args.length < least || args.length > most)
      return least === most
        ? `${fn} needs ${least} part${least === 1 ? '' : 's'}`
        : `${fn} needs ${least} to ${most} parts`;
    return { kind: 'fn', fn, args };
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
    return { ok: false, error: `unexpected "${tokenText(tokens[pos]!)}"` };
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
    } else if (n.kind === 'fn') {
      for (const arg of n.args) collect(arg);
    }
  };
  collect(node);
  if (refs.length === 0) return { ok: false, error: 'no fields' };
  return { ok: true, node, refs };
}

const tokenText = (token: Token) =>
  token.t === 'cmp' ? token.cmp : token.t === 'fn' ? token.fn : token.t;

/** 字段在公式里的类型：数字（数字、金额、评分、时长、别的公式）、日期、时间（HH:mm）、日期时间。 */
export type FormulaType = 'number' | 'date' | 'time' | 'datetime';

/** days()、hours()、minutes() 的参数是什么类型：只有字段和 today 会是日期类（别的式子都算出数字）。 */
function argType(n: FormulaNode, typeOf: (field: string) => FormulaType | null): FormulaType {
  if (n.kind === 'today') return 'date';
  return n.kind === 'ref' ? (typeOf(n.field) ?? 'number') : 'number';
}

/**
 * 公式的类型（D-247）：日期只能进 days() 和比较，加减乘除、负号和 if 的两个结果都要是数字。
 * 时间和日期时间（D-280）只能进 hours()、minutes() 和比较，日期时间也能进 days()。
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
    case 'days': {
      for (const part of [node.from, node.to]) {
        const got = formulaType(part, typeOf);
        if (typeof got !== 'string') return got;
        if (got !== 'date' && got !== 'datetime')
          return { error: `days() needs a date or datetime, not a ${got}` };
      }
      return 'number';
    }
    case 'fn': {
      if (node.fn === 'hours' || node.fn === 'minutes') {
        const from = formulaType(node.args[0]!, typeOf);
        if (typeof from !== 'string') return from;
        if (from !== 'time' && from !== 'datetime')
          return { error: `${node.fn}() needs two times or two datetimes, not a ${from}` };
        return need(node.args[1]!, from, `${node.fn}()`) ?? 'number';
      }
      for (const arg of node.args) {
        const bad = need(arg, 'number', `${node.fn}()`);
        if (bad) return bad;
      }
      return 'number';
    }
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

/** 时间 HH:mm → 当天的分钟数；不是时间时为 undefined。 */
export function minuteOfDay(time: string): number | undefined {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/** 本地日期时间 YYYY-MM-DDTHH:mm → 分钟数（按 UTC 算，不受夏令时影响）；不是日期时间时为 undefined。 */
export function minuteNumber(datetime: string): number | undefined {
  const day = dayNumber(datetime.slice(0, 10));
  const minute = datetime[10] === 'T' ? minuteOfDay(datetime.slice(11)) : undefined;
  return day === undefined || minute === undefined ? undefined : day * 1440 + minute;
}

/**
 * 计算；有字段没填、除以 0 或结果不是有限数时返回 undefined（不显示，也不计入统计）。
 * 日期字段由 valueOf 给出天数（dayNumber），时间给出当天的分钟数（minuteOfDay），日期时间给出分钟数
 * （minuteNumber），时长就是分钟数；today 是今天的天数，没给时用到 today 的公式没有值。
 * typeOf 给出字段的类型（days() 要把日期时间换成天数，hours() 要知道是不是跨午夜的时间）。
 */
export function evaluateFormula(
  node: FormulaNode,
  valueOf: (field: string) => number | undefined,
  today?: number,
  typeOf: (field: string) => FormulaType | null = () => 'number',
): number | undefined {
  const at = (n: FormulaNode) => evaluateFormula(n, valueOf, today, typeOf);
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'today':
      return today;
    case 'days': {
      // 日期时间按它那一天算。
      const day = (n: FormulaNode) => {
        const v = at(n);
        return v !== undefined && argType(n, typeOf) === 'datetime' ? Math.floor(v / 1440) : v;
      };
      const from = day(node.from);
      const to = day(node.to);
      return from === undefined || to === undefined ? undefined : to - from;
    }
    case 'fn': {
      const args = node.args.map(at);
      if (args.some((v) => v === undefined)) return undefined;
      const [a, b] = args as number[];
      switch (node.fn) {
        case 'min':
          return Math.min(...(args as number[]));
        case 'max':
          return Math.max(...(args as number[]));
        case 'abs':
          return Math.abs(a!);
        case 'round': {
          // 位数取整数、限制在 0–4（和字段的 decimals 一样），四舍五入（负数也往远离 0 的方向）。
          const f = 10 ** Math.min(4, Math.max(0, Math.round(b ?? 0)));
          return (Math.sign(a!) * Math.round(Math.abs(a!) * f + 1e-9)) / f;
        }
        case 'hours':
        case 'minutes': {
          let diff = b! - a!;
          // 时间只有几点几分：结束比开始早就是跨过了午夜。
          if (diff < 0 && argType(node.args[0]!, typeOf) === 'time') diff += 1440;
          return node.fn === 'hours' ? diff / 60 : diff;
        }
      }
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
