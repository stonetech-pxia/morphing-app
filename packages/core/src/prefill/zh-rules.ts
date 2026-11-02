// 中文票据的规则（测量见 side-session-notes/prefill-model/per-field/REPORT.md 的 SIBR 一节）：
// 大写金额；有效期、印制那排的日期不算，酒店账单取最晚的日期；单号按键名排优先级。

const NUM: Record<string, number> = {
  零: 0,
  〇: 0,
  壹: 1,
  贰: 2,
  叁: 3,
  肆: 4,
  伍: 5,
  陆: 6,
  柒: 7,
  捌: 8,
  玖: 9,
  貳: 2,
  參: 3,
  陸: 6,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const UNIT: Record<string, number> = { 拾: 10, 十: 10, 佰: 100, 百: 100, 仟: 1000, 千: 1000 };

/** 「贰拾捌元玖角」→ 28.9；认不出返回 null。 */
export function upperToNumber(raw: string): number | null {
  const s = raw.replace(/[\s人民币¥￥:：()（）大写]/g, '').replace(/[圆圓园]/g, '元');
  // 元后面的「零」只是占位：贰拾捌元零伍分、壹佰元零伍角。
  const m =
    /^(.*?)元零?(?:(.)角)?零?(?:(.)分)?[整正]?$/.exec(s) ?? /^()(.)角(?:(.)分)?[整正]?$/.exec(s);
  if (!m) return null;
  let total = 0;
  let sec = 0;
  let digit = 0;
  for (const c of m[1]!) {
    if (c in NUM) digit = NUM[c]!;
    else if (c in UNIT) {
      sec += (digit || 1) * UNIT[c]!;
      digit = 0;
    } else if (c === '万' || c === '萬') {
      total += (sec + digit) * 10000;
      sec = digit = 0;
    } else return null;
  }
  const j = m[2];
  const f = m[3];
  if ((j && !(j in NUM)) || (f && !(f in NUM))) return null;
  const v =
    Math.round((total + sec + digit + (j ? NUM[j]! / 10 : 0) + (f ? NUM[f]! / 100 : 0)) * 100) /
    100;
  return v > 0 ? v : null;
}

const UPPER_RUN = /[零壹贰貳叁參肆伍陆陸柒捌玖拾佰仟万萬元圆圓角分整正]{3,}/g;
/** 这一段标签说的是总额。 */
const UPPER_TOTAL =
  /合计|合計|总计|總計|总额|總額|总金额|金额|金額|应付|應付|实付|實付|应收|價稅|价税/;
/** 这一段标签说的是别的钱（找零、实收是收的现金，不是单据的金额）。 */
/** 这几排里写着「合计（大写）」，大写金额本身折到了下面（「金额合计（大写）：」下一排「收款： 肆拾元整」）。 */
const UPPER_ABOVE = /(?:合计|合計|总计|總計|金额|金額|人民币).{0,6}大[写寫与]/;
/** 这一段标签说的是别的钱（找零、实收是收的现金，不是单据的金额）。 */
const UPPER_OTHER =
  /小计|小計|税额|税金|稅額|服务费|服務費|手续费|押金|定金|订金|保证金|预付|预收|实收|實收|找零|优惠|優惠|折扣|减免|余额|餘額|单价|單價/;
/** 收款、现金也可能是票据左边那一栏的字，上面写着「合计（大写）」时不算别的钱。 */
const UPPER_SIDE = /收款(?!人|单位|方)|现金|現金/;

/**
 * 文字里的大写金额。要看那一段的标签：合计类的那一个优先；只有一个没写标签的也算；押金、实收这些不算，
 * 对不上就没有把握（给 null）。sure = 带小数的同一个数也在文字里（整数容易碰巧撞上，不算）。
 * OCR 常把大写断开，先去掉空格。
 */
export function upperAmount(rows: readonly string[]): { value: number; sure: boolean } | null {
  const totals: number[] = [];
  const plain: number[] = [];
  rows.forEach((row, i) => {
    const flat = row.replace(/\s+/g, '');
    const above = rows
      .slice(Math.max(0, i - 3), i)
      .some((r) => UPPER_ABOVE.test(r.replace(/\s+/g, '')));
    let from = 0;
    for (const m of flat.matchAll(UPPER_RUN)) {
      const run = m[0];
      const label = flat.slice(from, m.index);
      from = m.index + run.length;
      if (!/[元圆圓角]/.test(run)) continue;
      const v = upperToNumber(run);
      if (v === null) continue;
      const own = /小计|小計/.test(label) ? false : UPPER_TOTAL.test(label);
      if (own || (above && !UPPER_OTHER.test(label))) totals.push(v);
      else if (!UPPER_OTHER.test(label) && !UPPER_SIDE.test(label)) plain.push(v);
    }
  });
  const list = totals.length > 0 ? totals : plain;
  const hasDecimals = (v: number) => {
    const forms = [v.toFixed(2), v.toFixed(1)];
    return (
      v >= 1 &&
      rows.some((r) => {
        const t = r.replace(/[\s,，]/g, '');
        return forms.some((q) =>
          new RegExp(`(^|[^\\d.])${q.replace('.', '\\.')}(?![\\d])`).test(t),
        );
      })
    );
  };
  // 有几个时只认带小数也在文字里的那一个（OCR 把后面的字认成大写的碎片：陆角整）。
  const sure = [...new Set(list)].filter(hasDecimals);
  if (sure.length === 1) return { value: sure[0]!, sure: true };
  if (sure.length > 1 || new Set(list).size !== 1) return null;
  return { value: list[0]!, sure: false };
}

/** 有效期、印制、准印、监制所在的排：上面的日期不是票据日期。 */
export const BAD_DATE_ROW =
  /使用至|有效期|过期|到期|止[，,。]|印制|准印|监制|出生|\bexp\b|expir|valid\s*(?:until|thru|through|to)\b|good\s*thru|due\s*date|échéance|expire|valable/i;

/** 酒店账单的离店日那一排。 */
export const DEPART_ROW = /离店|departure|depart\b|结账日期|退房/i;
/** 酒店账单：离店那排常被排版串行，取全文最晚的日期（入住 ≤ 离店）。不是酒店（车票、机票也有 departure）不用。 */
export const HOTEL_DOC = /房号|房价|\broom\b|\bguest\b|\bfolio\b|入住|离店|抵店/i;
/** 机票、车票、接送单也有 departure 和 guest，它们不是酒店账单。 */
export const TRAVEL_DOC =
  /\b(?:flight|airline|boarding|shuttle|pick-?up|drop-?off|train|ferry|coach)\b|^\s*return\b|航班|机票|登机|车票|高铁|列车|接送|接机|送机/i;

// 明确说是这张单据的号的键名（英文、法文）：排在通用的 No 前面，值可以是字母开头（INV12345）。
const EXPLICIT_KEY =
  /(?:^|[^A-Za-z])(?:(?:tax\s*)?invoice|inv|receipt|rcpt|bill|facture)\s*(?:no\b|number|num[ée]ro|n°|nº|№|#)|(?:n°|nº|num[ée]ro)\s*de\s*facture/i;
// 通用的 No：什么都可能跟在后面，要看整排（见 genericNoAllowed）。
const GENERIC_KEY = /(?:^|[^A-Za-z])(?:NO|No|№|N[Oo0e]|N°|Nº)[.:：]?(?=\s*[A-Za-z]{0,2}\d)/;
// 单号的键名，按优先级。
const NO_KEYS: readonly RegExp[] = [
  /(?:电子)?票据号码?|发票号码?/,
  EXPLICIT_KEY,
  GENERIC_KEY,
  /机打(?:号码|票号)|电脑票号|收据号|单据号/,
  /账单号|帳单号|帐单号|folio\s*(?:no|number)?|invoice|facture/i,
];
/** 这些排上的号码不是单号：别的号码的键名（Tel No、Co No、Reg No……）和地址。 */
export const NOT_NO =
  /流水号|社保|社会保障|病历|门诊号|住院号|卡号|医保|身份证|电话|\btel\b|\bfax\b|\bphone\b|房号|\broom\b|确认号|\bconfirmation\b|会员|\bloyalty\b|预订号|\b(?:co|comp|company|reg|regn|registration|gst|sst|roc|ssm|vat|tax\s*id|siret|siren|tva|account|acct|a\/c|table|tbl|member|customer|cust|client|cashier|terminal|pos|batch|mobile|hp|passport|ic)\b\.?\s*(?:no\b|number|num[ée]ro|n°|nº|№|#)|\b(?:jalan|jln|lorong|taman|street|road|rue|avenue|blvd)\b/i;
const NO_ADDRESS = /\b(?:jalan|jln|lorong|taman|street|road|rue|avenue|blvd)\b/i;
/** 「NO8039067169」「N4510498」→ 数字部分。 */
export const stripNoPrefix = (s: string) => s.replace(/^(?:NO|No|no|N[oe0°º]?|№)[.:：]?(?=\d)/, '');

/** 通用的 No 前面紧挨着的英文词（「Tel No」的 Tel）：只有这些词说的才是这张单据的号。 */
const NO_OWNER =
  /^(?:folio|ticket|order|doc|document|ref|reference|cheque|check|voucher|trans|transaction|txn|re[çc]u|commande|tiket|nota|sales|slip)$/i;
function genericNoAllowed(row: string, before: string): boolean {
  // 这个 No 自己的那一段（上一个数或上一个「标签：」之后）：OCR 会把几格接成一排，「业务流水号： 医疗类型： NO. 123」
  // 的号不是流水号，「流水号 NO 123」才是。SIBR 上按整排查会丢掉很多对的单号（见 D-399）。地址字样看整排。
  const own =
    before
      .replace(/^[^]*\d/, '')
      .replace(/(?:医疗|医疗机构|医保)类型\S*/g, '：') // 「医疗类型城市医保」是另一格，不是医保号。
      .split(/[:：]/)
      .at(-1) ?? '';
  if (NOT_NO.test(own) || NO_ADDRESS.test(row)) return false;
  const word = /([A-Za-zÀ-ÿ/]+)[\s.]*$/.exec(before)?.[1];
  // 只有一个字母的是 OCR 的碎片（「皖财专（2014）P No 123」）。
  return word === undefined || word.length < 2 || NO_OWNER.test(word);
}

/** 按键名找单号；找不到返回 null。 */
export function invoiceNoByKey(rows: readonly string[]): string | null {
  for (const key of NO_KEYS) {
    const generic = key === GENERIC_KEY;
    // 明确的键名后面可以是字母开头（INV12345、INV/2026/7），短一点也算；其他的按 SIBR 上量的形状。
    const value =
      key === EXPLICIT_KEY
        ? /^[\s.:：#]*([A-Za-z]*[-/]?\d[A-Za-z0-9/-]{2,})/
        : /^[\s.:：]*((?:[A-Za-z]{0,2})?\d[A-Za-z0-9-]{4,})/;
    for (const row of rows) {
      const k = key.exec(row);
      if (!k) continue;
      const after = row.slice(k.index + k[0].length);
      const m = value.exec(after);
      if (!m) continue;
      // 键名的正则带着前面那一个字符（不是字母）。
      const before = row.slice(0, k.index + (/^[A-Za-z№]/.test(k[0]) ? 0 : 1));
      if (
        generic
          ? !genericNoAllowed(row, before)
          : NOT_NO.test(after.slice(0, m[0].length).replace(m[1]!, ''))
      )
        continue;
      // 键名后面是日期（Invoice 2026-10-30），不是号。
      if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(m[1]!)) continue;
      return stripNoPrefix(m[1]!);
    }
  }
  return null;
}
