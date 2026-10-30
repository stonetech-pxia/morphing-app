import { DEFAULT_CALENDAR, dateOfDayNumber, weekStartOf, type Calendar } from './calendar';
import { ScheduleRuleSchema, type ScheduleRule } from './schedule';

// 在用户打的一行字里找一个日期 / 时间 / 重复的说法（「周五下午3点交报告」「every month on the 1st」
// 「demain à 15h」）。纯规则，在手机上跑，不是 AI，也不发给任何地方。中、英、法三种说法不看界面语言，
// 都认。只认一处：开始得最早的那处，同一位置取最长的；挨着的日期和时间（中间只有空格、「的」、at、à）
// 合成一处。一切按传进来的 today（天数）和 cal.weekStart 算，不读时钟。

export type DatePhraseValue =
  | { kind: 'date'; date: string; time?: string }
  | { kind: 'time'; time: string }
  | { kind: 'repeat'; rule: ScheduleRule; time?: string };

export interface DatePhrase {
  start: number;
  end: number;
  value: DatePhraseValue;
}

/** 一处匹配的结果：日期（天数）、时间（HH:mm）、重复规则，三者之一（算不出的日子是 undefined，丢掉）。 */
interface Found {
  date?: number | undefined;
  time?: string | undefined;
  rule?: ScheduleRule | undefined;
}
interface Part extends Found {
  start: number;
  end: number;
}
interface Ctx {
  today: number;
  cal: Calendar;
  y: number;
  m: number;
  d: number;
  /** 今天星期几：1 = 周一 … 7 = 周日。 */
  wd: number;
  norm: string;
  at: number;
}
type Rule = [RegExp, (g: RegExpExecArray, c: Ctx) => Found | undefined];

// ---- 词表 ----

/** 「一组, 一组」→ 词 → 第几组（从 first 起）：每组里的词同义。 */
function table(groups: string, first = 1): Record<string, number> {
  const out: Record<string, number> = {};
  groups.split(',').forEach((g, i) =>
    g
      .trim()
      .split(' ')
      .forEach((w) => (out[w] = i + first)),
  );
  return out;
}
const ZH_DIGIT = table('零 〇, 一, 二 两, 三, 四, 五, 六, 七, 八, 九', 0);
const WORD_NUM = table(
  'one un une 1er, two deux, three trois, four quatre, five cinq, six, seven sept, eight huit, nine neuf, ten dix',
);
const ZH_WEEKDAY = table('一, 二, 三, 四, 五, 六, 日 天');
const EN_WEEKDAY = table(
  'monday mon, tuesday tues tue, wednesday wed, thursday thurs thur thu, friday fri, saturday sat, sunday sun',
);
const FR_WEEKDAY = table('lundi, mardi, mercredi, jeudi, vendredi, samedi, dimanche');
// 英文、法文的月份（法文已去掉重音）。
const MONTHS = table(
  'january jan janvier janv, february feb fevrier fevr fev, march mar mars, april apr avril avr, may mai, ' +
    'june jun juin, july jul juillet juil, august aug aout, september sept sep septembre, ' +
    'october oct octobre, november nov novembre, december dec decembre',
);
const PERIODS = '凌晨|早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里';

/** 长的写在前面，免得 sept 抢了 septembre。 */
const alt = (words: Record<string, number>) =>
  Object.keys(words)
    .sort((a, b) => b.length - a.length)
    .join('|');
const N = '(\\d{1,2}|[零〇一二两三四五六七八九十]{1,3})';
const WN =
  '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|une?|deux|trois|quatre|cinq|sept|huit|neuf|dix)';
const MON = `(${alt(MONTHS)})\\.?`;
const ORD = '(?:st|nd|rd|th)?';
const EN_DAY = `(?:${alt(EN_WEEKDAY)})s?`;
const FR_DAY = `(?:${alt(FR_WEEKDAY)})s?`;
const re = (src: string) => new RegExp(src, 'g');

// ---- 数字、日子、钟点 ----

/** 阿拉伯数字、one…ten / un…dix、一…三十一。认不出时 undefined。 */
function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  if (/^\d+$/.test(s)) return Number(s);
  if (WORD_NUM[s] !== undefined) return WORD_NUM[s];
  const [a = '', b, extra] = s.split('十');
  if (extra !== undefined) return undefined;
  if (b === undefined) {
    let n = 0;
    for (const ch of a) {
      const v = ZH_DIGIT[ch];
      if (v === undefined) return undefined;
      n = n * 10 + v;
    }
    return n;
  }
  const tens = a === '' ? 1 : a.length === 1 ? ZH_DIGIT[a] : undefined;
  const ones = b === '' ? 0 : b.length === 1 ? ZH_DIGIT[b] : undefined;
  return tens === undefined || ones === undefined ? undefined : tens * 10 + ones;
}

/** 年月日 → 天数；不存在的日子（2 月 30 日）为 undefined。 */
function mk(y: number, m: number, d: number): number | undefined {
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  return d >= 1 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? t / 86_400_000 : undefined;
}

/** 某月某日：没写年份时是今年的，已经过了就是明年的。 */
function monthDay(
  c: Ctx,
  m: number | undefined,
  d: number | undefined,
  y?: number,
): Found | undefined {
  if (m === undefined || d === undefined) return undefined;
  if (y !== undefined) return { date: mk(y, m, d) };
  const n = mk(c.y, m, d);
  return { date: n !== undefined && n < c.today ? mk(c.y + 1, m, d) : n };
}

/** 只说了几号：这个月的，已经过了（或这个月没有这天）就往后找。 */
function dayOnly(c: Ctx, d: number | undefined): Found | undefined {
  if (d === undefined || d < 1 || d > 31) return undefined;
  for (let k = 0; k < 3; k++) {
    const n = mk(c.y + Math.floor((c.m - 1 + k) / 12), ((c.m - 1 + k) % 12) + 1, d);
    if (n !== undefined && n >= c.today) return { date: n };
  }
  return undefined;
}

/** 接下来的那个星期几（今天就是的话是今天）。 */
const coming = (c: Ctx, wd: number) => c.today + ((wd - c.wd + 7) % 7);
/** 这周（k = 1 下周，-1 上周）的星期几，周从 cal.weekStart 算起。 */
const inWeek = (c: Ctx, wd: number, k = 0) =>
  weekStartOf(c.today, c.cal) + ((wd - (c.cal.weekStart === 'monday' ? 1 : 7) + 7) % 7) + 7 * k;
const thisWeekend = (c: Ctx) => (c.wd === 7 ? c.today : coming(c, 6));
const firstOfNextMonth = (c: Ctx) => (c.m === 12 ? mk(c.y + 1, 1, 1) : mk(c.y, c.m + 1, 1));

/** HH:mm；25 点、61 分这种不算时间。 */
function hm(h: number | undefined, min = 0): Found | undefined {
  if (h === undefined || h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return { time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` };
}
/** 下午 / 晚上的 1–11 点加 12；中午 1–5 点加 12；晚上 12 点是 0 点。 */
function zhHour(period: string | undefined, h: number | undefined): number | undefined {
  if (h === undefined || period === undefined) return h;
  if (/下午|傍晚|晚上|夜里/.test(period) && h >= 1 && h <= 11) return h + 12;
  if (period === '中午' && h >= 1 && h <= 5) return h + 12;
  if (/晚上|夜里/.test(period) && h === 12) return 0;
  return h;
}
function ampm(
  h: number | undefined,
  min: string | undefined,
  p: string | undefined,
): Found | undefined {
  if (h === undefined || h < 1 || h > 12) return undefined;
  return hm((h % 12) + (p === 'p' ? 12 : 0), Number(min ?? 0));
}

// ---- 重复规则 ----

/** 只放过 ScheduleRuleSchema 认的规则。 */
function rule(r: ScheduleRule): Found | undefined {
  return ScheduleRuleSchema.safeParse(r).success ? { rule: r } : undefined;
}
const weekdays = (days: number[]) =>
  rule({ repeat: 'weekdays', days: [...new Set(days)].sort((a, b) => a - b) });
const monthDays = (d: number | undefined) =>
  d === undefined ? undefined : rule({ repeat: 'monthDays', days: [d] });
const interval = (n: number | undefined) =>
  n === undefined
    ? undefined
    : n === 1
      ? rule({ repeat: 'daily' })
      : rule({ repeat: 'interval', every: n });
function yearly(month: number | undefined, day: number | undefined): Found | undefined {
  // 闰年里有的日子都算（每年 2 月 29 日）。
  if (month === undefined || day === undefined || mk(2000, month, day) === undefined)
    return undefined;
  return rule({ repeat: 'yearly', month, day });
}
const WORKDAYS = [1, 2, 3, 4, 5];

/** 「一三五」「一到五」「周一和周三」里的星期几。 */
function zhDays(s: string): number[] {
  const out: number[] = [];
  let range = false;
  for (const ch of s) {
    const n = ZH_WEEKDAY[ch];
    if (n !== undefined) {
      const prev = out[out.length - 1];
      if (range && prev !== undefined) for (let k = prev + 1; k < n; k++) out.push(k);
      out.push(n);
      range = false;
    } else if ('到至~-'.includes(ch)) range = true;
  }
  return out;
}
/** 「mon/wed/fri」「lundis et jeudis」里的星期几。 */
function wordDays(s: string, table: Record<string, number>): number[] {
  return (s.match(/[a-z]+/g) ?? [])
    .map((w) => table[w] ?? table[w.replace(/s$/, '')])
    .filter((n): n is number => n !== undefined);
}

// ---- 规则表（在去掉重音、小写过的文字上匹配） ----

const ZH_REL: Record<string, number> = {
  大后天: 3,
  后天: 2,
  明天: 1,
  明日: 1,
  今天: 0,
  今日: 0,
  昨天: -1,
};
const EN_REL: Record<string, number> = { tomorrow: 1, tmr: 1, tmrw: 1, today: 0, yesterday: -1 };
const FR_REL: Record<string, number> = { "aujourd'hui": 0, aujourdhui: 0, demain: 1, hier: -1 };

const RULES: Rule[] = [
  // 时间
  [
    re(`(${PERIODS})?${N}点钟?(?:(半)|(一刻)|(三刻)|${N}分?)?`),
    (g, c) => {
      const min = g[3] ? 30 : g[4] ? 15 : g[5] ? 45 : (num(g[6]) ?? 0);
      return hm(zhHour(g[1], num(g[2])), min);
    },
  ],
  [
    re(`(?:at\\s+|a\\s+|(${PERIODS}))?(\\d{1,2}):(\\d{2})`),
    (g) => hm(zhHour(g[1], num(g[2])), Number(g[3])),
  ],
  [re('(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(a|p)\\.?m\\.?'), (g) => ampm(num(g[1]), g[2], g[3])],
  [re('at\\s+(\\d{1,2})'), (g) => hm(num(g[1]))],
  [
    re('(?:at\\s+|a\\s+)?(noon|midnight|midi|minuit)'),
    (g) => hm(g[1] === 'noon' || g[1] === 'midi' ? 12 : 0),
  ],
  [
    re('(?:a\\s+)?(\\d{1,2})\\s?h(?:eures?)?(?:\\s?(\\d{2}))?'),
    (g) => hm(num(g[1]), Number(g[2] ?? 0)),
  ],

  // 日期：中文
  [re(alt(ZH_REL)), (g, c) => ({ date: c.today + ZH_REL[g[0]]! })],
  [
    re(`${N}天(?:以后|之后|后)`),
    (g, c) => {
      const n = num(g[1]);
      return n === undefined ? undefined : { date: c.today + n };
    },
  ],
  [
    re('(?:(下|这|本|上)个?)?(?:周([一二三四五六日])|(?:星期|礼拜)([一二三四五六日天]))'),
    (g, c) => {
      const wd = ZH_WEEKDAY[g[2] ?? g[3]!]!;
      const k = { 下: 1, 这: 0, 本: 0, 上: -1 }[g[1] ?? ''];
      return { date: k === undefined ? coming(c, wd) : inWeek(c, wd, k) };
    },
  ],
  [re('(?:(下)|这|本)?个?周末'), (g, c) => ({ date: g[1] ? inWeek(c, 6, 1) : thisWeekend(c) })],
  [re('下个?(?:周|星期|礼拜)'), (g, c) => ({ date: weekStartOf(c.today, c.cal) + 7 })],
  [
    re(`下个?月(?:${N}[号日])?`),
    (g, c) => {
      const first = firstOfNextMonth(c)!;
      if (!g[1]) return { date: first };
      const d = new Date(first * 86_400_000);
      return { date: mk(d.getUTCFullYear(), d.getUTCMonth() + 1, num(g[1]) ?? 0) };
    },
  ],
  [re(`(?:(\\d{4})年)?${N}月${N}[日号]`), (g, c) => monthDay(c, num(g[2]), num(g[3]), num(g[1]))],
  // 只说几号：「日」只跟阿拉伯数字（「一日三餐」不算），「3号线」「2号楼」不算。
  [
    re(`(?:${N}号|(\\d{1,2})日)(?![楼线房门床位车])`),
    (g, c) => (c.norm.charAt(c.at - 1) === '月' ? undefined : dayOnly(c, num(g[1] ?? g[2]))),
  ],
  [
    re('(\\d{4})-(\\d{1,2})-(\\d{1,2})'),
    (g) => ({ date: mk(Number(g[1]), Number(g[2]), Number(g[3])) }),
  ],

  // 日期：英文
  [re('(?:the\\s+)?day\\s+after\\s+tomorrow'), (g, c) => ({ date: c.today + 2 })],
  [re(alt(EN_REL)), (g, c) => ({ date: c.today + EN_REL[g[0]]! })],
  [re(`in\\s+${WN}\\s+days?`), (g, c) => ({ date: c.today + num(g[1])! })],
  [re('next\\s+week'), (g, c) => ({ date: weekStartOf(c.today, c.cal) + 7 })],
  [
    re('(?:(next)\\s+|this\\s+|ce\\s+)?week-?end'),
    (g, c) => ({ date: g[1] ? inWeek(c, 6, 1) : thisWeekend(c) }),
  ],
  [re('next\\s+month'), (g, c) => ({ date: firstOfNextMonth(c) })],
  // 「next friday」是下周的周五（同「下周五」）；「this / on friday」和光说「friday」是接下来的那个。
  // 三个字母的缩写（sun、sat、wed 是常见词）只跟在 next / this / on 后面才算。
  [
    re(
      `(?:(next|this|on)\\s+)?(${Object.keys(EN_WEEKDAY)
        .filter((w) => w.length > 5)
        .join('|')})`,
    ),
    (g, c) => {
      const wd = EN_WEEKDAY[g[2]!]!;
      return { date: g[1] === 'next' ? inWeek(c, wd, 1) : coming(c, wd) };
    },
  ],
  [
    re(`(next|this|on)\\s+(${alt(EN_WEEKDAY)})\\.?`),
    (g, c) => {
      const wd = EN_WEEKDAY[g[2]!]!;
      return { date: g[1] === 'next' ? inWeek(c, wd, 1) : coming(c, wd) };
    },
  ],
  [
    re(`(?:on\\s+)?${MON}\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?`),
    (g, c) => monthDay(c, MONTHS[g[1]!], num(g[2]), num(g[3])),
  ],
  [
    re(
      `(?:on\\s+|le\\s+|the\\s+)?(\\d{1,2}|1er)(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}(?:\\s+(\\d{4}))?`,
    ),
    (g, c) => monthDay(c, MONTHS[g[2]!], num(g[1]), num(g[3])),
  ],
  [re('(?:on\\s+)?the\\s+(\\d{1,2})(?:st|nd|rd|th)'), (g, c) => dayOnly(c, num(g[1]))],

  // 日期：法文。「lundi prochain」是今天之后的下一个周一；「ce lundi」和光说「lundi」是接下来的那个。
  [re('apres[-\\s]demain'), (g, c) => ({ date: c.today + 2 })],
  [re(alt(FR_REL)), (g, c) => ({ date: c.today + FR_REL[g[0]]! })],
  [re(`dans\\s+${WN}\\s+jours?`), (g, c) => ({ date: c.today + num(g[1])! })],
  [re('(?:la\\s+)?semaine\\s+prochaine'), (g, c) => ({ date: weekStartOf(c.today, c.cal) + 7 })],
  [re('(?:le\\s+)?week-?end\\s+prochain'), (g, c) => ({ date: inWeek(c, 6, 1) })],
  [re('(?:le\\s+)?mois\\s+prochain'), (g, c) => ({ date: firstOfNextMonth(c) })],
  [
    re(`(?:ce\\s+)?(${alt(FR_WEEKDAY)})(?:\\s+(prochain))?`),
    (g, c) => {
      const wd = FR_WEEKDAY[g[1]!]!;
      return { date: g[2] ? c.today + ((wd - c.wd + 6) % 7) + 1 : coming(c, wd) };
    },
  ],

  // 重复：中文
  [re('每[天日]'), () => rule({ repeat: 'daily' })],
  [re('(?:每个?)?工作日'), () => weekdays(WORKDAYS)],
  [re('每个?(?:周|星期|礼拜)末'), () => weekdays([6, 7])],
  [
    re(
      '每个?(?:周|星期|礼拜)([一二三四五六日](?:[\\s、,，和及与到至~-]*(?:周|星期|礼拜)?[一二三四五六日])*)?',
    ),
    (g, c) => weekdays(g[1] ? zhDays(g[1]) : [c.wd]),
  ],
  [
    re(`每个?月的?(?:(最后一天|底)|${N}[号日])?`),
    (g, c) => monthDays(g[1] ? -1 : g[2] ? num(g[2]) : c.d),
  ],
  [re(`每隔?${N}个?[天日]`), (g) => interval(num(g[1]))],
  [
    re(`每年的?(?:${N}月${N}[日号])?`),
    (g, c) => (g[1] ? yearly(num(g[1]), num(g[2])) : yearly(c.m, c.d)),
  ],

  // 重复：英文
  [re('every\\s*day|daily'), () => rule({ repeat: 'daily' })],
  [re('every\\s+(?:other|second)\\s+day'), () => interval(2)],
  [re(`every\\s+${WN}\\s+days`), (g) => interval(num(g[1]))],
  [
    re('every\\s+(?:weekday|work\\s?day|business\\s+day)|(?:on\\s+)?weekdays'),
    () => weekdays(WORKDAYS),
  ],
  [re('every\\s+weekend'), () => weekdays([6, 7])],
  [
    re(`every\\s+(${EN_DAY}(?:\\s*(?:,\\s*and|,|/|&|and)\\s*${EN_DAY})*)`),
    (g) => weekdays(wordDays(g[1]!, EN_WEEKDAY)),
  ],
  [re('every\\s+week|weekly'), (g, c) => weekdays([c.wd])],
  [
    re(
      `every\\s+month\\s+on\\s+the\\s+(\\d{1,2})${ORD}|every\\s+(\\d{1,2})(?:st|nd|rd|th)(?:\\s+of\\s+(?:the|each|every)\\s+month)?`,
    ),
    (g) => monthDays(num(g[1] ?? g[2])),
  ],
  [
    re('every\\s+last\\s+day\\s+of\\s+the\\s+month|every\\s+month\\s+on\\s+the\\s+last\\s+day'),
    () => monthDays(-1),
  ],
  [re('every\\s+month|monthly'), (g, c) => monthDays(c.d)],
  [
    re(`every\\s+(?:year\\s+on\\s+)?${MON}\\s+(\\d{1,2})${ORD}`),
    (g) => yearly(MONTHS[g[1]!], num(g[2])),
  ],
  [
    re(`every\\s+(?:year\\s+on\\s+)?(?:the\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MON}`),
    (g) => yearly(MONTHS[g[2]!], num(g[1])),
  ],
  [re('every\\s+year|yearly|annually'), (g, c) => yearly(c.m, c.d)],

  // 重复：法文
  [re('tous\\s+les\\s+jours|chaque\\s+jour|quotidiennement'), () => rule({ repeat: 'daily' })],
  [
    re(
      'tous\\s+les\\s+jours\\s+(?:ouvr(?:es|ables)|de\\s+semaine)|en\\s+semaine|du\\s+lundi\\s+au\\s+vendredi',
    ),
    () => weekdays(WORKDAYS),
  ],
  [re(`tous\\s+les\\s+${WN}\\s+jours`), (g) => interval(num(g[1]))],
  [
    re(`(?:tous\\s+les|chaque)\\s+(${FR_DAY}(?:\\s*(?:,|et)\\s*${FR_DAY})*)`),
    (g) => weekdays(wordDays(g[1]!, FR_WEEKDAY)),
  ],
  [re('toutes\\s+les\\s+semaines|chaque\\s+semaine|hebdomadaire'), (g, c) => weekdays([c.wd])],
  [
    re(
      'le\\s+(\\d{1,2}|1er)\\s+de\\s+chaque\\s+mois|tous\\s+les\\s+mois\\s+le\\s+(\\d{1,2}|1er)|chaque\\s+(\\d{1,2}|1er)\\s+du\\s+mois',
    ),
    (g) => monthDays(num(g[1] ?? g[2] ?? g[3])),
  ],
  [
    re(
      '(?:tous\\s+les\\s+mois\\s+|chaque\\s+mois\\s+)?le\\s+dernier\\s+jour\\s+(?:du|de\\s+chaque)\\s+mois',
    ),
    () => monthDays(-1),
  ],
  [re('tous\\s+les\\s+mois|chaque\\s+mois|mensuellement'), (g, c) => monthDays(c.d)],
  [
    re(
      `(?:tous\\s+les\\s+ans|chaque\\s+annee)\\s+(?:le\\s+)?(\\d{1,2}|1er)\\s+${MON}|chaque\\s+(\\d{1,2}|1er)\\s+${MON}`,
    ),
    (g) => (g[1] ? yearly(MONTHS[g[2]!], num(g[1])) : yearly(MONTHS[g[4]!], num(g[3]))),
  ],
  [re('tous\\s+les\\s+ans|chaque\\s+annee|annuellement'), (g, c) => yearly(c.m, c.d)],
];

// ---- 匹配 ----

const FOLD: Record<string, string> = {
  à: 'a',
  â: 'a',
  ä: 'a',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  î: 'i',
  ï: 'i',
  ô: 'o',
  ö: 'o',
  ù: 'u',
  û: 'u',
  ü: 'u',
  ç: 'c',
  '’': "'",
  ʼ: "'",
};
/** 小写、去掉法文重音，长度不变（下标和原文一一对应）。不用 normalize，Hermes 上不一定可靠。 */
function fold(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const lower = ch.toLowerCase();
    const c = lower.length === 1 ? lower : ch;
    out += FOLD[c] ?? c;
  }
  return out;
}

const WORD = /[a-z0-9]/;
const ZH_NUM = /[零〇一二两三四五六七八九十]/;
/** 不在更长的词里：「sundayschool」「Monday.com」不算，「today's」算；中文数字前面不能再接中文数字。 */
function bounded(s: string, start: number, end: number): boolean {
  const first = s.charAt(start);
  const before = s.charAt(start - 1);
  if (
    start > 0 &&
    ((WORD.test(first) && WORD.test(before)) || (ZH_NUM.test(first) && ZH_NUM.test(before)))
  )
    return false;
  const next = s.charAt(end);
  if (!WORD.test(s.charAt(end - 1))) return true;
  return !WORD.test(next) && !(next === '.' && /[a-z]/.test(s.charAt(end + 1)));
}

export function findDatePhrase(
  text: string,
  today: number,
  cal: Calendar = DEFAULT_CALENDAR,
): DatePhrase | undefined {
  const norm = fold(text);
  const t = new Date(today * 86_400_000);
  const base = {
    today,
    cal,
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    wd: ((((today + 3) % 7) + 7) % 7) + 1,
    norm,
  };
  const parts: Part[] = [];
  for (const [regex, read] of RULES) {
    regex.lastIndex = 0;
    for (let g = regex.exec(norm); g; g = regex.exec(norm)) {
      const start = g.index;
      const end = start + g[0].length;
      regex.lastIndex = start + 1; // 每个位置都试一次，被拒的匹配不挡住后面的
      if (end === start || !bounded(norm, start, end)) continue;
      const found = read(g, { ...base, at: start });
      if (found && (found.date !== undefined || found.time !== undefined || found.rule))
        parts.push({ start, end, ...found });
    }
  }
  // 日期 / 重复和挨着的时间合成一处（时间在后面优先，也可以在前面：「3pm tomorrow」）。
  const gap = (a: number, b: number) => a <= b && /^[\s,，的]*$/.test(norm.slice(a, b));
  const earliestLongest = (a: Part, b: Part) => a.start - b.start || b.end - a.end;
  const times = parts.filter((p) => p.time !== undefined).sort(earliestLongest);
  const all = [...parts];
  for (const p of parts) {
    if (p.time !== undefined) continue;
    const after = times.find((x) => x.start >= p.end && gap(p.end, x.start));
    const before = times.find((x) => x.end <= p.start && gap(x.end, p.start));
    const time = after ?? before;
    if (time)
      all.push({
        ...p,
        start: Math.min(p.start, time.start),
        end: Math.max(p.end, time.end),
        time: time.time,
      });
  }
  const best = all.sort(earliestLongest)[0];
  if (!best) return undefined;
  const { start, end, date, time, rule: r } = best;
  const value: DatePhraseValue = r
    ? { kind: 'repeat', rule: r, ...(time ? { time } : {}) }
    : date !== undefined
      ? { kind: 'date', date: dateOfDayNumber(date), ...(time ? { time } : {}) }
      : { kind: 'time', time: time! };
  return { start, end, value };
}

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
/** 去掉这一处，连带它留下的「在」「at」「à」「le」「on」、多余的空格和两头的标点。 */
export function withoutPhrase(text: string, phrase: DatePhrase): string {
  const before = text
    .slice(0, phrase.start)
    .replace(/(?:^|\s)(?:at|à|le|on)\s*$/i, '')
    .replace(/在\s*$/, '')
    .replace(/[\s,，、;；:：\-–—]+$/, '');
  const after = text.slice(phrase.end).replace(/^[\s,，、;；:：.。!！?？\-–—的]+/, '');
  const sep =
    !before || !after || CJK.test(before.charAt(before.length - 1)) || CJK.test(after.charAt(0))
      ? ''
      : ' ';
  return (before + sep + after).replace(/^[\s,，、;；:：\-–—]+|[\s,，、;；:：\-–—]+$/g, '');
}
