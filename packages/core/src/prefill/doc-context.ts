// 这一份文档的上下文：规则在打分前后要知道币种、整份文字、这一排有几个金额、现在是哪一年。
// suggestValues / planDocument 开头设置，同步用完（里面没有 await），所以放模块变量。
export type DocumentKind = '' | 'card' | 'receipt' | 'other';

export const ctx: {
  currency: string;
  text: string;
  /** 正在读的这一排里有几个两位小数的数（空格千位分隔的判断用）。 */
  rowMany: number;
  /** 「现在」的年份：两位年的世纪判断用。 */
  nowYear: number;
  /** 文字看起来是发票（不是小票）。 */
  invoice: boolean;
  /** 用哪组规则（表上的 prefillRules，other = 只有通用规则）；'' = 没经过 planDocument。 */
  kind: DocumentKind;
} = {
  kind: '',
  rowMany: 0,
  nowYear: 0,
  invoice: false,
  currency: '',
  text: '',
};

/** 一份文档算完后清掉上下文，没经过 planDocument 的调用（附件文字、检查）不会用到上一份文档的币种和文字。 */
export function resetDocContext(): void {
  ctx.rowMany = 0;
  ctx.nowYear = 0;
  ctx.invoice = false;
  ctx.kind = '';
  ctx.currency = '';
  ctx.text = '';
}

/** 收据规则（D-403）只对收据生效；没经过 planDocument 的调用（kind 为 ''）照旧。 */
export const receiptRules = (): boolean => ctx.kind === '' || ctx.kind === 'receipt';
/** 名片规则只对名片生效。 */
export const cardRules = (): boolean => ctx.kind === 'card';

/** planDocument 之后的同步调用（问模型、核对模型的答案）也按这张表的规则走。 */
export function withDocKind<T>(kind: DocumentKind, work: () => T): T {
  const before = ctx.kind;
  ctx.kind = kind;
  try {
    return work();
  } finally {
    ctx.kind = before;
  }
}
