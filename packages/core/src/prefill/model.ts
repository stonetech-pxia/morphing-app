import type { Field } from '../schema';
import { checkAnswer, keepForModel, squash } from './check';
import { categoryAnswers, categoryRequest } from './category';
import { conceptOf, type ConceptId } from './concepts';

// 本机模型给候选（D-396、D-401）：Qwen3.5-2B，只问代码拿不准的字段，一个字段问一次。文字生成由外面注入
// （App 里是 llama.rn，电脑上打分用 llama-server），这里只有提示词、语法和读回答。
// 模型的回答要一个一个过核对（check.ts），编不出文字里没有的值；结果只进候选，用户点了才填（D-394）。
// 提示词、语法、参数和测量时一样（side-session-notes/prefill-model/per-field/sibr/pf9.ts），改了要重新打分。

/** 一次文字生成。prompt 已经是完整的提示；前面相同的部分由实现复用缓存。 */
export interface ModelRequest {
  prompt: string;
  grammar: string;
  temperature: number;
  seed: number;
  nPredict: number;
  stop: readonly string[];
}

/** 加载好的模型。用完由引擎调 release（成功、失败、取消都调）。 */
export interface ModelSession {
  /** signal 取消时实现应该尽快停；引擎不等它，所以停不下来也不会卡住表单。 */
  generate(request: ModelRequest, signal: AbortSignal): Promise<string>;
  release(): Promise<void>;
}

/** 加载模型；没装、内存不够时给 null。引擎用完就释放，不常驻。 */
export type OpenModel = (signal: AbortSignal) => Promise<ModelSession | null>;

export const MODEL_LIMITS = {
  /** 给模型的文字最多多少个字：上下文 4096 token，留出提示词、问题和回答；中文约一字一个 token。 */
  textChars: 3000,
  /** 加载模型、问一个字段、整张单据的时间上限（超过就停，留着已经有的候选）。 */
  openMs: 60_000,
  callMs: 30_000,
  totalMs: 120_000,
};
export type ModelLimits = typeof MODEL_LIMITS;

const SYSTEM =
  'You read the OCR text of one document. Then you are asked for one field at a time. ' +
  'Answer with the value of that field copied from the text exactly as written, without its label, ' +
  'or null only when the text does not show it. ' +
  'Use only what is written in the text: no guessing, no outside knowledge. ' +
  'A value next to a label for something else is not this field. Output only the value.';

// 认得出的字段加一句提示；用户自建的字段只靠字段名。
const HINTS: Partial<Record<ConceptId, string>> = {
  amount:
    'the final amount paid (after rounding and discounts); not subtotal, tax, change, cash tendered or item prices',
  tax: 'a separate tax amount; not a tax rate and not a total that includes tax',
  issueDate: 'the date of the document',
  merchant: 'the shop or issuer name; not an address, slogan or sample text',
  company: 'the organization name; not a person name or address',
  name: 'a person name; on a business card the person, not the company',
  number: 'a document number written next to its label; not a phone, address, item or sample code',
  phone: 'a phone number',
  email: 'an email address',
  address: 'a postal address',
  category: 'only when the text names it',
};

/** 这个字段问模型的那句话。 */
export function fieldQuestion(f: Field): string {
  const kind = f.type === 'money' || f.type === 'number' ? 'amount' : f.type;
  const concept = conceptOf(f);
  const hint = concept ? HINTS[concept] : undefined;
  const how =
    f.type === 'date'
      ? 'Give it as YYYY-MM-DD, reading the day and month order of the document.'
      : f.type === 'money' || f.type === 'number'
        ? 'Copy the amount as written.'
        : 'Copy its value from the text.';
  return `Field "${f.name}" (${kind})${hint ? `: ${hint}` : ''}. ${how} List up to 3 different values from the text that could be this field, most likely first, separated by " | ". Answer null only if the text shows none.`;
}

/** 最多 3 个候选，用「 | 」隔开；或者 null。 */
export const MODEL_GRAMMAR =
  'root ::= "null" | item (" | " item)? (" | " item)?\nitem ::= [^\\n<|]+';

/** 单据是哪种语言（只看文字，界面语言和单据语言常常不一样）：有中文是 zh，有法语的字样是 fr，否则 en。 */
export function documentLanguage(rows: readonly string[]): 'zh' | 'fr' | 'en' {
  const text = rows.join('\n');
  if (/[㐀-鿿]/.test(text)) return 'zh';
  if (/[éèêàçùœ]|\b(tva|montant|facture|reçu|espèces|ttc)\b/i.test(text)) return 'fr';
  return 'en';
}

/** 文字太长时去掉中间的排：店名在开头，合计在结尾。 */
function fitText(rows: readonly string[], limit: number): string[] {
  const size = (list: readonly string[]) => list.reduce((n, r) => n + r.length + 1, 0);
  if (size(rows) <= limit) return [...rows];
  const take = (list: readonly string[], budget: number) => {
    const out: string[] = [];
    let used = 0;
    for (const row of list) {
      // 一排就超过的（PDF 里没有换行的长文）切开。
      const piece = row.slice(0, Math.max(0, budget - used - 1));
      if (piece) out.push(piece);
      used += piece.length + 1;
      if (used >= budget) break;
    }
    return out;
  };
  const head = take(rows, Math.floor(limit * 0.6));
  const tail = take([...rows].reverse(), limit - Math.floor(limit * 0.6)).reverse();
  return [...head, ...tail];
}

/** 这张单据问每个字段时相同的那段（系统提示 + 文字；字段自己的排只有问它时才有）；模型加载一次，相同的前缀只读一遍。 */
function documentPrefix(f: Field, rows: readonly string[], limits: ModelLimits): string {
  const kept = fitText(
    rows.filter((r) => keepForModel(r, f)),
    limits.textChars,
  );
  return (
    `<|im_start|>system\n${SYSTEM}<|im_end|>\n` +
    `<|im_start|>user\nDocument language: ${documentLanguage(rows)}.\nTEXT:\n${kept.join('\n')}\n\n`
  );
}

/** 问一个字段的完整请求。手写 ChatML：空的 think 块等于关掉 thinking，llama.rn 的 jinja 路径不加助手开头。 */
export function modelRequest(
  f: Field,
  rows: readonly string[],
  limits: ModelLimits = MODEL_LIMITS,
): ModelRequest {
  // 分类字段（单选）问的是「选哪个选项」，不是抄文字里的值（D-405）。
  if (f.type === 'choice') return categoryRequest(f, rows, limits.textChars);
  return {
    prompt:
      `${documentPrefix(f, rows, limits)}${fieldQuestion(f)}<|im_end|>\n` +
      '<|im_start|>assistant\n<think>\n\n</think>\n\n',
    grammar: MODEL_GRAMMAR,
    temperature: 0,
    seed: 42,
    nPredict: 120,
    stop: ['\n', '<|im_end|>'],
  };
}

/** 模型的回答 → 核对过的值（表单的写法，去重，最多 3 个）。 */
export function modelAnswers(
  f: Field,
  answer: string,
  rows: readonly string[],
  locale: Parameters<typeof checkAnswer>[3],
): string[] {
  if (f.type === 'choice') return categoryAnswers(f, answer);
  const out: string[] = [];
  for (const part of answer.split('|')) {
    const value = checkAnswer(f, part, rows, locale);
    if (value !== null && !out.some((v) => squash(v) === squash(value))) out.push(value);
  }
  return out.slice(0, 3);
}
