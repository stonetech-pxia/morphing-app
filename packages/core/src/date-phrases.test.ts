import { describe, expect, it } from 'vitest';

import { DEFAULT_CALENDAR, dateOfDayNumber, type Calendar } from './calendar';
import { findDatePhrase, withoutPhrase, type DatePhraseValue } from './date-phrases';
import { dayNumber } from './formula';
import { ScheduleRuleSchema } from './schedule';

// 2026-10-30 是星期五。
const today = dayNumber('2026-10-30')!;
const sundayWeek: Calendar = { ...DEFAULT_CALENDAR, weekStart: 'sunday' };

/** 认出的那段原文和值。 */
function find(text: string, cal?: Calendar): { said: string; value: DatePhraseValue } | undefined {
  const p = findDatePhrase(text, today, cal);
  return p && { said: text.slice(p.start, p.end), value: p.value };
}
const date = (d: string, time?: string): DatePhraseValue => ({
  kind: 'date',
  date: d,
  ...(time ? { time } : {}),
});
const time = (t: string): DatePhraseValue => ({ kind: 'time', time: t });

function expectDate(text: string, said: string, d: string, t?: string, cal?: Calendar) {
  expect(find(text, cal)).toEqual({ said, value: date(d, t) });
}
function expectRepeat(text: string, said: string, rule: object, t?: string) {
  const found = find(text);
  expect(found).toEqual({ said, value: { kind: 'repeat', rule, ...(t ? { time: t } : {}) } });
  if (found?.value.kind === 'repeat')
    expect(ScheduleRuleSchema.safeParse(found.value.rule).success).toBe(true);
}

it('pins today to a Friday', () => {
  expect(dateOfDayNumber(today)).toBe('2026-10-30');
  expect(new Date(today * 86_400_000).getUTCDay()).toBe(5);
});

describe('中文日期', () => {
  it.each([
    ['今天交报告', '今天', '2026-10-30'],
    ['明天交报告', '明天', '2026-10-31'],
    ['后天交报告', '后天', '2026-11-01'],
    ['大后天交报告', '大后天', '2026-11-02'],
    ['昨天的账', '昨天', '2026-10-29'],
    ['3天后提醒', '3天后', '2026-11-02'],
    ['三天以后提醒', '三天以后', '2026-11-02'],
    ['下周开会', '下周', '2026-11-02'],
    ['周末大扫除', '周末', '2026-10-31'],
    ['这周末大扫除', '这周末', '2026-10-31'],
    ['下周末去爬山', '下周末', '2026-11-07'],
    ['下个月交房租', '下个月', '2026-11-01'],
    ['下个月5号交房租', '下个月5号', '2026-11-05'],
    ['周五交报告', '周五', '2026-10-30'],
    ['星期一开会', '星期一', '2026-11-02'],
    ['礼拜天休息', '礼拜天', '2026-11-01'],
    ['这周一的会', '这周一', '2026-10-26'],
    ['本周三', '本周三', '2026-10-28'],
    ['下周五交报告', '下周五', '2026-11-06'],
    ['下个星期二', '下个星期二', '2026-11-03'],
    ['上周五的账', '上周五', '2026-10-23'],
    ['11月5日交报告', '11月5日', '2026-11-05'],
    ['十一月五号交报告', '十一月五号', '2026-11-05'],
    ['3月5日体检', '3月5日', '2027-03-05'],
    ['2026年11月5日', '2026年11月5日', '2026-11-05'],
    ['5号交房租', '5号', '2026-11-05'],
    ['31日交房租', '31日', '2026-10-31'],
    ['二十号交房租', '二十号', '2026-11-20'],
    ['截止 2026-11-05', '2026-11-05', '2026-11-05'],
  ])('%s', (text, said, d) => expectDate(text, said, d));

  it('date and time merge', () => {
    expectDate('周五下午3点交报告', '周五下午3点', '2026-10-30', '15:00');
    expectDate('明天的下午3点半开会', '明天的下午3点半', '2026-10-31', '15:30');
    expectDate('明天 15:30 开会', '明天 15:30', '2026-10-31', '15:30');
    expectDate('2026-11-05 09:00 出发', '2026-11-05 09:00', '2026-11-05', '09:00');
  });
});

describe('中文时间', () => {
  it.each([
    ['3点开会', '3点', '03:00'],
    ['下午3点开会', '下午3点', '15:00'],
    ['下午3点半开会', '下午3点半', '15:30'],
    ['下午3点15分开会', '下午3点15分', '15:15'],
    ['下午三点一刻', '下午三点一刻', '15:15'],
    ['晚上9点跑步', '晚上9点', '21:00'],
    ['早上8点起床', '早上8点', '08:00'],
    ['上午10点', '上午10点', '10:00'],
    ['中午12点吃饭', '中午12点', '12:00'],
    ['中午1点吃饭', '中午1点', '13:00'],
    ['凌晨2点', '凌晨2点', '02:00'],
    ['15:30开会', '15:30', '15:30'],
    ['15点开会', '15点', '15:00'],
    ['十点开会', '十点', '10:00'],
  ])('%s', (text, said, t) => expect(find(text)).toEqual({ said, value: time(t) }));

  it('25点 and 24:00 are not times', () => {
    expect(find('25点')).toBeUndefined();
    expect(find('24:00')).toBeUndefined();
  });
});

describe('中文重复', () => {
  it.each([
    ['每天背单词', '每天', { repeat: 'daily' }],
    ['每日打卡', '每日', { repeat: 'daily' }],
    ['每个工作日打卡', '每个工作日', { repeat: 'weekdays', days: [1, 2, 3, 4, 5] }],
    ['工作日打卡', '工作日', { repeat: 'weekdays', days: [1, 2, 3, 4, 5] }],
    ['每周一到周五打卡', '每周一到周五', { repeat: 'weekdays', days: [1, 2, 3, 4, 5] }],
    ['每周一开周会', '每周一', { repeat: 'weekdays', days: [1] }],
    ['每周一三五健身', '每周一三五', { repeat: 'weekdays', days: [1, 3, 5] }],
    ['每周一和周三健身', '每周一和周三', { repeat: 'weekdays', days: [1, 3] }],
    ['每个周一开会', '每个周一', { repeat: 'weekdays', days: [1] }],
    ['每周打扫', '每周', { repeat: 'weekdays', days: [5] }],
    ['每月5号交房租', '每月5号', { repeat: 'monthDays', days: [5] }],
    ['每月5日交房租', '每月5日', { repeat: 'monthDays', days: [5] }],
    ['每个月5号交房租', '每个月5号', { repeat: 'monthDays', days: [5] }],
    ['每月最后一天对账', '每月最后一天', { repeat: 'monthDays', days: [-1] }],
    ['每月对账', '每月', { repeat: 'monthDays', days: [30] }],
    ['每隔3天浇水', '每隔3天', { repeat: 'interval', every: 3 }],
    ['每3天浇水', '每3天', { repeat: 'interval', every: 3 }],
    ['每两天浇水', '每两天', { repeat: 'interval', every: 2 }],
    ['每1天', '每1天', { repeat: 'daily' }],
    ['每年11月5日纪念日', '每年11月5日', { repeat: 'yearly', month: 11, day: 5 }],
    ['每年体检', '每年', { repeat: 'yearly', month: 10, day: 30 }],
  ])('%s', (text, said, rule) => expectRepeat(text, said, rule));

  it('repeat carries a time', () => {
    expectRepeat('每天早上8点吃药', '每天早上8点', { repeat: 'daily' }, '08:00');
    expectRepeat('每周五下午3点周会', '每周五下午3点', { repeat: 'weekdays', days: [5] }, '15:00');
  });
});

describe('English dates', () => {
  it.each([
    ['Call mom today', 'today', '2026-10-30'],
    ['Call mom tomorrow', 'tomorrow', '2026-10-31'],
    ['Call mom tmr', 'tmr', '2026-10-31'],
    ['Call mom the day after tomorrow', 'the day after tomorrow', '2026-11-01'],
    ['Log yesterday', 'yesterday', '2026-10-29'],
    ['Check in 3 days', 'in 3 days', '2026-11-02'],
    ['Check in three days', 'in three days', '2026-11-02'],
    ['Plan next week', 'next week', '2026-11-02'],
    ['Hike this weekend', 'this weekend', '2026-10-31'],
    ['Hike weekend', 'weekend', '2026-10-31'],
    ['Hike next weekend', 'next weekend', '2026-11-07'],
    ['Budget next month', 'next month', '2026-11-01'],
    ['Gym Monday', 'Monday', '2026-11-02'],
    ["Monday's meeting", 'Monday', '2026-11-02'],
    ['Report friday', 'friday', '2026-10-30'],
    ['Report next friday', 'next friday', '2026-11-06'],
    ['Report this friday', 'this friday', '2026-10-30'],
    ['Report on friday', 'on friday', '2026-10-30'],
    ['Brunch on sun', 'on sun', '2026-11-01'],
    ['Brunch next sat', 'next sat', '2026-11-07'],
    ['Vote Nov 5', 'Nov 5', '2026-11-05'],
    ['Vote November 5th', 'November 5th', '2026-11-05'],
    ['Vote 5 Nov', '5 Nov', '2026-11-05'],
    ['Vote on March 5', 'on March 5', '2027-03-05'],
    ['Pay the 5th', 'the 5th', '2026-11-05'],
    ['Ship 2026-11-05', '2026-11-05', '2026-11-05'],
  ])('%s', (text, said, d) => expectDate(text, said, d));

  it('time and merges', () => {
    expect(find('Call at 3pm')).toEqual({ said: 'at 3pm', value: time('15:00') });
    expect(find('Call 3 pm')).toEqual({ said: '3 pm', value: time('15:00') });
    expect(find('Call 3:30pm')).toEqual({ said: '3:30pm', value: time('15:30') });
    expect(find('Call at 15:00')).toEqual({ said: 'at 15:00', value: time('15:00') });
    expect(find('Call at 3')).toEqual({ said: 'at 3', value: time('03:00') });
    expect(find('Lunch at noon')).toEqual({ said: 'at noon', value: time('12:00') });
    expect(find('Deploy midnight')).toEqual({ said: 'midnight', value: time('00:00') });
    expect(find('Call 12am')).toEqual({ said: '12am', value: time('00:00') });
    expectDate('Call mom tomorrow at 3pm', 'tomorrow at 3pm', '2026-10-31', '15:00');
    expectDate('Call mom 3pm tomorrow', '3pm tomorrow', '2026-10-31', '15:00');
  });
});

describe('English repeats', () => {
  it.each([
    ['Stretch every day', 'every day', { repeat: 'daily' }],
    ['Stretch daily', 'daily', { repeat: 'daily' }],
    ['Standup every weekday', 'every weekday', { repeat: 'weekdays', days: [1, 2, 3, 4, 5] }],
    ['Gym every monday', 'every monday', { repeat: 'weekdays', days: [1] }],
    [
      'Gym every monday and wednesday',
      'every monday and wednesday',
      { repeat: 'weekdays', days: [1, 3] },
    ],
    ['Gym every mon/wed/fri', 'every mon/wed/fri', { repeat: 'weekdays', days: [1, 3, 5] }],
    ['Clean every week', 'every week', { repeat: 'weekdays', days: [5] }],
    ['Clean weekly', 'weekly', { repeat: 'weekdays', days: [5] }],
    ['Review every month', 'every month', { repeat: 'monthDays', days: [30] }],
    ['Create monthly report', 'monthly', { repeat: 'monthDays', days: [30] }],
    [
      'Pay rent every month on the 1st',
      'every month on the 1st',
      { repeat: 'monthDays', days: [1] },
    ],
    ['Pay rent every 5th', 'every 5th', { repeat: 'monthDays', days: [5] }],
    [
      'Close books every last day of the month',
      'every last day of the month',
      { repeat: 'monthDays', days: [-1] },
    ],
    ['Water every 3 days', 'every 3 days', { repeat: 'interval', every: 3 }],
    ['Water every other day', 'every other day', { repeat: 'interval', every: 2 }],
    ['Checkup every year', 'every year', { repeat: 'yearly', month: 10, day: 30 }],
    ['Checkup yearly', 'yearly', { repeat: 'yearly', month: 10, day: 30 }],
    [
      'Birthday every year on Nov 5',
      'every year on Nov 5',
      { repeat: 'yearly', month: 11, day: 5 },
    ],
    ['Birthday every Nov 5', 'every Nov 5', { repeat: 'yearly', month: 11, day: 5 }],
  ])('%s', (text, said, rule) => expectRepeat(text, said, rule));

  it('repeat carries a time', () => {
    expectRepeat('Pills every day at 9am', 'every day at 9am', { repeat: 'daily' }, '09:00');
  });
});

describe('dates français', () => {
  it.each([
    ["Payer aujourd'hui", "aujourd'hui", '2026-10-30'],
    ['Payer aujourd’hui', 'aujourd’hui', '2026-10-30'],
    ['Appeler demain', 'demain', '2026-10-31'],
    ['Appeler après-demain', 'après-demain', '2026-11-01'],
    ['Appeler apres-demain', 'apres-demain', '2026-11-01'],
    ['Noter hier', 'hier', '2026-10-29'],
    ['Relancer dans 3 jours', 'dans 3 jours', '2026-11-02'],
    ['Relancer dans trois jours', 'dans trois jours', '2026-11-02'],
    ['Réunion la semaine prochaine', 'la semaine prochaine', '2026-11-02'],
    ['Rando ce week-end', 'ce week-end', '2026-10-31'],
    ['Rando ce weekend', 'ce weekend', '2026-10-31'],
    ['Rando le week-end prochain', 'le week-end prochain', '2026-11-07'],
    ['Budget le mois prochain', 'le mois prochain', '2026-11-01'],
    ['Sport lundi', 'lundi', '2026-11-02'],
    ['Rapport vendredi', 'vendredi', '2026-10-30'],
    ['Rapport vendredi prochain', 'vendredi prochain', '2026-11-06'],
    ['Sport lundi prochain', 'lundi prochain', '2026-11-02'],
    ['Sport ce lundi', 'ce lundi', '2026-11-02'],
    ['Vote le 5 novembre', 'le 5 novembre', '2026-11-05'],
    ['Vote 5 nov.', '5 nov.', '2026-11-05'],
    ['Vote 1er décembre', '1er décembre', '2026-12-01'],
    ['Livrer 2026-11-05', '2026-11-05', '2026-11-05'],
  ])('%s', (text, said, d) => expectDate(text, said, d));

  it('heures', () => {
    expect(find('Réunion 15h')).toEqual({ said: '15h', value: time('15:00') });
    expect(find('Réunion 15h30')).toEqual({ said: '15h30', value: time('15:30') });
    expect(find('Réunion 15 h')).toEqual({ said: '15 h', value: time('15:00') });
    expect(find('Réunion à 15h')).toEqual({ said: 'à 15h', value: time('15:00') });
    expect(find('Réunion 15:30')).toEqual({ said: '15:30', value: time('15:30') });
    expect(find('Déjeuner à midi')).toEqual({ said: 'à midi', value: time('12:00') });
    expect(find('Fête minuit')).toEqual({ said: 'minuit', value: time('00:00') });
    expectDate('Appeler Paul demain à 15h', 'demain à 15h', '2026-10-31', '15:00');
  });
});

describe('répétitions', () => {
  it.each([
    ['Marcher tous les jours', 'tous les jours', { repeat: 'daily' }],
    ['Marcher chaque jour', 'chaque jour', { repeat: 'daily' }],
    ['Marcher quotidiennement', 'quotidiennement', { repeat: 'daily' }],
    ['Pointer en semaine', 'en semaine', { repeat: 'weekdays', days: [1, 2, 3, 4, 5] }],
    [
      'Pointer tous les jours ouvrés',
      'tous les jours ouvrés',
      { repeat: 'weekdays', days: [1, 2, 3, 4, 5] },
    ],
    [
      'Pointer du lundi au vendredi',
      'du lundi au vendredi',
      { repeat: 'weekdays', days: [1, 2, 3, 4, 5] },
    ],
    ['Sport tous les lundis', 'tous les lundis', { repeat: 'weekdays', days: [1] }],
    ['Sport chaque lundi', 'chaque lundi', { repeat: 'weekdays', days: [1] }],
    [
      'Sport tous les lundis et jeudis',
      'tous les lundis et jeudis',
      { repeat: 'weekdays', days: [1, 4] },
    ],
    ['Ménage toutes les semaines', 'toutes les semaines', { repeat: 'weekdays', days: [5] }],
    ['Ménage chaque semaine', 'chaque semaine', { repeat: 'weekdays', days: [5] }],
    ['Bilan tous les mois', 'tous les mois', { repeat: 'monthDays', days: [30] }],
    ['Bilan chaque mois', 'chaque mois', { repeat: 'monthDays', days: [30] }],
    ['Loyer le 5 de chaque mois', 'le 5 de chaque mois', { repeat: 'monthDays', days: [5] }],
    ['Loyer tous les mois le 5', 'tous les mois le 5', { repeat: 'monthDays', days: [5] }],
    ['Loyer chaque 5 du mois', 'chaque 5 du mois', { repeat: 'monthDays', days: [5] }],
    [
      'Clôture le dernier jour du mois',
      'le dernier jour du mois',
      { repeat: 'monthDays', days: [-1] },
    ],
    ['Arroser tous les 3 jours', 'tous les 3 jours', { repeat: 'interval', every: 3 }],
    ['Arroser tous les deux jours', 'tous les deux jours', { repeat: 'interval', every: 2 }],
    ['Bilan tous les ans', 'tous les ans', { repeat: 'yearly', month: 10, day: 30 }],
    ['Bilan chaque année', 'chaque année', { repeat: 'yearly', month: 10, day: 30 }],
    [
      'Anniv tous les ans le 5 novembre',
      'tous les ans le 5 novembre',
      { repeat: 'yearly', month: 11, day: 5 },
    ],
    ['Anniv chaque 5 novembre', 'chaque 5 novembre', { repeat: 'yearly', month: 11, day: 5 }],
  ])('%s', (text, said, rule) => expectRepeat(text, said, rule));

  it('avec une heure', () => {
    expectRepeat(
      'Médicament tous les jours à 8h',
      'tous les jours à 8h',
      { repeat: 'daily' },
      '08:00',
    );
  });
});

describe('week start and rollover', () => {
  it('weekStart sunday moves next week', () => {
    expectDate('下周开会', '下周', '2026-11-01', undefined, sundayWeek);
    expectDate('Plan next week', 'next week', '2026-11-01', undefined, sundayWeek);
    expectDate('La semaine prochaine', 'La semaine prochaine', '2026-11-01', undefined, sundayWeek);
    // 周日开头时「这周一」是 10-26，「下周一」是 11-02。
    expectDate('这周一', '这周一', '2026-10-26', undefined, sundayWeek);
  });

  it('weekend on a Sunday is today', () => {
    const sunday = dayNumber('2026-11-01')!;
    const p = findDatePhrase('周末', sunday)!;
    expect(p.value).toEqual(date('2026-11-01'));
  });

  it('past month-day rolls to next year; past day rolls to next month', () => {
    expectDate('Jan 1 party', 'Jan 1', '2027-01-01');
    expectDate('10月29日', '10月29日', '2027-10-29');
    expectDate('29号', '29号', '2026-11-29');
  });

  it('December rolls the year for next month', () => {
    const dec = dayNumber('2026-12-15')!;
    expect(findDatePhrase('next month', dec)!.value).toEqual(date('2027-01-01'));
  });
});

describe('first and longest', () => {
  it('earliest start wins', () => {
    expect(find('明天 或 后天')?.said).toBe('明天');
    expect(find('Call friday or monday')?.said).toBe('friday');
  });
  it('mixed languages in one line', () => {
    expectDate('Réunion 周五 3pm', '周五 3pm', '2026-10-30', '15:00');
  });
});

describe('no match', () => {
  it.each([
    'Buy sunscreen',
    'May I help',
    'Plan for May',
    '下载文件',
    '看周报',
    '这周天气很好',
    '一日三餐',
    '坐3号线',
    '2月30日',
    'Feb 30',
    '2026-02-30',
    'sundayschool notes',
    // 「Monday.com」是产品名：点后面紧跟字母时算一个词，不认。
    'Monday.com invoice',
    'Wed a friend',
    'weekends are nice',
  ])('%s', (text) => expect(find(text)).toBeUndefined());
});

describe('withoutPhrase', () => {
  const strip = (text: string) => withoutPhrase(text, findDatePhrase(text, today)!);
  it.each([
    ['周五下午3点交报告', '交报告'],
    ['Pay rent every month on the 1st', 'Pay rent'],
    ['Appeler Paul demain à 15h', 'Appeler Paul'],
    ['会议在周五', '会议'],
    ['交报告 明天', '交报告'],
    ['Call mom at 3pm today', 'Call mom'],
    ['Lunch with Ann tomorrow, downtown', 'Lunch with Ann downtown'],
    ['Call mom on 2026-11-05', 'Call mom'],
    ['Rendez-vous le 5 novembre chez Paul', 'Rendez-vous chez Paul'],
    ['明天的会议', '会议'],
  ])('%s → %s', (text, out) => expect(strip(text)).toBe(out));
});
