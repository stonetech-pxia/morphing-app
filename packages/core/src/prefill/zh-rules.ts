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
  const s = raw.replace(/[\s人民币¥￥:：()（）大写]/g, '').replace(/[圆园]/g, '元');
  const m = /^(.*?)元(?:(.)角)?(?:(.)分)?整?$/.exec(s) ?? /^()(.)角(?:(.)分)?整?$/.exec(s);
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

const UPPER_RUN = /[零壹贰叁肆伍陆柒捌玖拾佰仟万萬元圆角分整]{3,}/g;

/** 文字里的大写金额；sure = 带小数的同一个数也在文字里（整数容易碰巧撞上，不算）。OCR 常把大写断开，先去掉空格。 */
export function upperAmount(rows: readonly string[]): { value: number; sure: boolean } | null {
  for (const row of rows) {
    for (const run of row.replace(/\s+/g, '').match(UPPER_RUN) ?? []) {
      if (!/[元圆角]/.test(run)) continue;
      const v = upperToNumber(run);
      if (v === null) continue;
      const forms = [v.toFixed(2), v.toFixed(1)];
      const sure =
        v >= 1 &&
        rows.some((r) => {
          const t = r.replace(/[\s,，]/g, '');
          return forms.some((q) =>
            new RegExp(`(^|[^\\d.])${q.replace('.', '\\.')}(?![\\d])`).test(t),
          );
        });
      return { value: v, sure };
    }
  }
  return null;
}

/** 有效期、印制、准印、监制所在的排：上面的日期不是票据日期。 */
export const BAD_DATE_ROW = /使用至|有效期|过期|止[，,。]|印制|准印|监制|出生/;

/** 酒店账单的离店日那一排。 */
export const DEPART_ROW = /离店|departure|depart\b|结账日期|退房/i;
/** 酒店账单：离店那排常被排版串行，取全文最晚的日期（入住 ≤ 离店）。不是酒店（车票、机票也有 departure）不用。 */
export const HOTEL_DOC = /房号|房价|room|guest|folio|入住|离店|抵店/i;

// 单号的键名，按优先级。
const NO_KEYS: readonly RegExp[] = [
  /(?:电子)?票据号码?|发票号码?/,
  /(?:^|[^A-Za-z])(?:NO|No|№|N[Oo0e])[.:：]?(?=\s*[A-Za-z]{0,2}\d)/,
  /机打(?:号码|票号)|电脑票号|收据号|单据号/,
  /账单号|帳单号|帐单号|folio\s*(?:no|number)?|invoice\s*(?:no)?/i,
];
/** 这些排上的号码不是单号。 */
export const NOT_NO =
  /流水号|社保|社会保障|病历|门诊号|住院号|卡号|医保|身份证|电话|\btel\b|房号|\broom\b|确认号|\bconfirmation\b|会员|\bloyalty\b|预订号/i;

/** 「NO8039067169」「N4510498」→ 数字部分。 */
export const stripNoPrefix = (s: string) => s.replace(/^(?:NO|No|no|N[oe0]?|№)[.:：]?(?=\d)/, '');

/** 按键名找单号；找不到返回 null。 */
export function invoiceNoByKey(rows: readonly string[]): string | null {
  for (const key of NO_KEYS) {
    for (const row of rows) {
      const k = key.exec(row);
      if (!k) continue;
      const after = row.slice(k.index + k[0].length);
      const m = /^[\s.:：]*((?:[A-Za-z]{0,2})?\d[A-Za-z0-9-]{4,})/.exec(after);
      if (!m) continue;
      if (NOT_NO.test(after.slice(0, m[0].length).replace(m[1]!, ''))) continue;
      return stripNoPrefix(m[1]!);
    }
  }
  return null;
}
