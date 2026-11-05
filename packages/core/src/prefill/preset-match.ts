import type { NewTablePreset } from '../templates';
import { ruleCandidates } from './candidates';
import { bounded, free } from './engine';
import { fitText, MODEL_LIMITS, type ModelRequest, type OpenModel } from './model';
import type { TextPage } from './rows';

// 导入文件后新建表单：哪些预设靠前（D-444）。规则先排序：没有金额的文件，要金额的预设排到后面（不隐藏，
// 文字识别可能漏掉金额）；能确定的信号（护照机读码、IBAN）排到最前。本机 2B 只从没有被排后的预设里选一个，
// 结果只是推荐，用户点了才用（底线 D-396）。文字和结果都不联网、不发给云端 AI（底线 1、2）。

const DESCRIPTIONS: Record<NewTablePreset, string> = {
  bank: 'bank account statement with transactions and balance',
  bill: 'utility, phone or service bill or invoice to pay',
  contacts: 'business card or contact details of a person',
  contract: 'agreement between parties with terms and signatures',
  education: 'diploma, certificate or transcript',
  identity: 'passport, ID card, driving licence or other identity document',
  insurance: 'insurance policy or certificate',
  lab: 'medical test results with measured values',
  lease: 'rental agreement for a home',
  loan: 'loan or mortgage agreement or statement',
  payslip: 'salary slip with gross and net pay',
  pet: 'veterinary or pet record',
  prescription: 'doctor prescription of medicines',
  property: 'deed or proof of owning property',
  purchase: 'shop or restaurant receipt, proof of purchase',
  reimbursement: 'expense claim to be paid back',
  tax: 'tax return or tax notice',
  travel: 'plane, train or hotel booking or ticket',
  vaccination: 'vaccination record',
  vehicle: 'vehicle registration or inspection document',
  warranty: 'product warranty or guarantee',
};
export const NEW_TABLE_PRESETS = Object.keys(DESCRIPTIONS) as NewTablePreset[];

/** 这些预设的文件上一定有金额。 */
const NEEDS_MONEY: readonly NewTablePreset[] = [
  'bank',
  'bill',
  'loan',
  'payslip',
  'purchase',
  'reimbursement',
  'tax',
];

export interface PresetRanking {
  /** 靠前的预设（确定的信号在最前）。 */
  likely: NewTablePreset[];
  /** 排到后面的：规则看到文件里缺它们一定有的东西。 */
  unlikely: NewTablePreset[];
}

const textOf = (pages: readonly TextPage[]) =>
  pages.flatMap((p) => p.lines.map((l) => l.text)).join('\n');

/** 文字里有金额吗：带货币符号或代码的数，或「数.两位小数」。 */
function hasMoney(text: string): boolean {
  if (
    /(?:[$€£¥￥₹]|\b(?:usd|eur|gbp|cny|rmb|chf|cad|aud|inr)\b)\s?\d|\d\s?(?:[$€£¥￥₹元]|(?:usd|eur|gbp|cny|rmb|chf|cad|aud|inr)\b)/i.test(
      text,
    )
  )
    return true;
  return /(?:^|\s)\d{1,3}(?:[ .,]\d{3})*[.,]\d{2}(?:\s|$)/m.test(text);
}

/** 规则给预设排序。没读到文字时不排后任何预设。 */
export function rankPresets(pages: readonly TextPage[]): PresetRanking {
  const text = textOf(pages);
  if (!text.trim()) return { likely: [...NEW_TABLE_PRESETS], unlikely: [] };
  const sure: NewTablePreset[] = [];
  if (/P<[A-Z<]{3}[A-Z<]{5,}/.test(text.replace(/ /g, ''))) sure.push('identity');
  if (/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9*]{4}){2,}/.test(text)) sure.push('bank');
  const money = hasMoney(text) || ruleMoney(text);
  const unlikely = money ? [] : NEEDS_MONEY.filter((p) => !sure.includes(p));
  return {
    likely: [
      ...sure,
      ...NEW_TABLE_PRESETS.filter((p) => !sure.includes(p) && !unlikely.includes(p)),
    ],
    unlikely,
  };
}

const ruleMoney = (text: string) =>
  text
    .split('\n')
    .some((row) =>
      ruleCandidates(row, 'en').some((c) => c.kind === 'amount' && /[.,]\d{2}\b/.test(c.raw)),
    );

/** 问模型的请求：文件文字 + 目录，只答一个 ID（第三轮冻结的提示词 P3，目录按 ranking 取）。 */
export function presetMatchRequest(
  pages: readonly TextPage[],
  ids: readonly NewTablePreset[],
): ModelRequest {
  const rows = pages.flatMap((p) =>
    [...p.lines].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.text.trim()),
  );
  const document = fitText(rows.filter(Boolean), MODEL_LIMITS.textChars).join('\n');
  const catalog = ids.map((id) => `${id}: ${DESCRIPTIONS[id]}`).join('\n');
  return {
    prompt:
      '<|im_start|>system\nYou classify documents for a personal records app. ' +
      'Decide what kind of document this is from its content, even without a title. Answer one ID.\n' +
      `Templates:\n${catalog}\nnone: not one of these kinds, such as personal writing or general information<|im_end|>\n` +
      `<|im_start|>user\nDocument:\n${document}\n\nWhich ID describes this document?<|im_end|>\n` +
      '<|im_start|>assistant\n<think>\n\n</think>\n\n',
    grammar: `root ::= ${[...ids, 'none'].map((id) => `"${id}"`).join(' | ')}\n`,
    temperature: 0,
    seed: 42,
    nPredict: 6,
    stop: ['<|im_end|>'],
  };
}

/** 模型的回答 → 预设；none、不认识的、不在目录里的都是 null。 */
export function presetAnswer(
  answer: string,
  ids: readonly NewTablePreset[],
): NewTablePreset | null {
  const id = answer.trim() as NewTablePreset;
  return ids.includes(id) ? id : null;
}

/**
 * 本机模型推荐一个预设。没装、内存不够、加载失败、超时、取消：一律安静地给 null，
 * 用户照样能从规则排好的列表里选，或者点字段名。
 */
export async function recommendPreset(
  open: OpenModel,
  pages: readonly TextPage[],
  signal?: AbortSignal,
): Promise<NewTablePreset | null> {
  const { likely } = rankPresets(pages);
  if (!textOf(pages).trim() || likely.length === 0 || signal?.aborted) return null;
  const stop = new AbortController();
  const abort = () => stop.abort();
  signal?.addEventListener('abort', abort);
  const total = setTimeout(abort, MODEL_LIMITS.totalMs);
  let session: Awaited<ReturnType<OpenModel>> | undefined;
  try {
    const opening = open(stop.signal);
    session = await bounded(opening, stop.signal, MODEL_LIMITS.openMs);
    if (session === undefined) {
      void opening.then((late) => late && free(late)).catch(() => undefined);
      stop.abort();
      return null;
    }
    if (session === null) return null;
    const answer = await bounded(
      session.generate(presetMatchRequest(pages, likely), stop.signal),
      stop.signal,
      MODEL_LIMITS.callMs,
    );
    return answer === undefined ? null : presetAnswer(answer, likely);
  } catch {
    return null;
  } finally {
    clearTimeout(total);
    signal?.removeEventListener('abort', abort);
    if (session) free(session);
  }
}
