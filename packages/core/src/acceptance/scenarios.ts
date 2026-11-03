import type { EvalSetup } from '../ai/eval-cases';
import { parseFormula } from '../formula';
import { tablesOf, type Field, type Locale, type Localized } from '../schema';
import {
  aggregatesOn,
  canAdd,
  chartBlocks,
  completionCreates,
  completionReschedules,
  createFills,
  createKnowsDay,
  dayField,
  displayed,
  entryAsks,
  entryFills,
  entryWrites,
  isOneTap,
  numberBlocks,
  oneTapCreateTables,
  oneTapTables,
  recordBlocks,
  reminderReaches,
  reminderTime,
  rollupInputsFilled,
  rollupsOver,
  rowExists,
  statInputsFilled,
  tableIds,
  tableOf,
  type AppView,
} from './capabilities';

// 验收场景（范围 D-374：打卡 / 习惯、日历、待办优先，记账是边界，再加文件进记录）。
// 每项要求是用户真要的结果，同一需求的几种合理建法都要算过；都要写在同一张表上才算接起来。
// ask 是用户发现缺这项时会说的一句话，实验台（lab.ts --acceptance）一次说一句。

export interface Requirement {
  id: string;
  cap: (v: AppView) => boolean;
  ask: Localized;
  /** core 全过才算合格。 */
  core: boolean;
}

export type ScenarioCategory = 'habit' | 'calendar' | 'todo' | 'money' | 'fileToRecord';

export interface Scenario {
  id: string;
  category: ScenarioCategory;
  locale: Locale;
  setup: Extract<EvalSetup, 'default'>;
  opening: string;
  requirements: readonly Requirement[];
}

const some = (v: AppView, test: (table: string) => boolean) => tableIds(v).some(test);

const fieldsOf = (v: AppView, table: string): readonly Field[] => tableOf(v, table)?.fields ?? [];

/** 用户写得进去一个标题：文字字段在写入口上有值。 */
const hasTitleInput = (v: AppView, table: string) =>
  canAdd(v, table) &&
  fieldsOf(v, table).some(
    (f) => (f.type === 'text' || f.type === 'note') && entryWrites(v, table, f.id),
  );

/** 记一条，日子有值。 */
const loggable = (v: AppView, table: string) =>
  canAdd(v, table) && entryFills(v, table, dayField(v, table));

/** 金额：写入口填得到。 */
const hasAmountInput = (v: AppView, table: string) =>
  canAdd(v, table) &&
  fieldsOf(v, table).some(
    (f) => (f.type === 'money' || f.type === 'number') && entryWrites(v, table, f.id),
  );

/** 分类：单选或引用，写入口填得到。 */
const hasCategoryInput = (v: AppView, table: string) =>
  fieldsOf(v, table).some(
    (f) => (f.type === 'choice' || f.type === 'link') && entryWrites(v, table, f.id),
  );

const calendars = (v: AppView, table?: string) =>
  recordBlocks(v, table).filter((b) => b.look === 'calendar');

const calendarDayFilled = (v: AppView, table: string) =>
  calendars(v, table).some((b) => entryFills(v, table, dayField(v, table, b.source.group?.by)));

// ---- 打卡 ----

/** 点大圆块就记（写的那张表）。 */
const tapWrites = (v: AppView) =>
  v.writes.filter(
    (w) =>
      w.as === 'tap' &&
      isOneTap(w) &&
      rowExists(v, w) &&
      (w.tool.do !== 'create' || createKnowsDay(v, w)),
  );

const tapStreakTables = (v: AppView) =>
  tapWrites(v)
    .filter((w) => w.tool.do === 'create' && aggregatesOn(v, w.tool.table, ['streak']))
    .map((w) => w.tool.table);

const WEEK_PERIODS: readonly unknown[] = ['thisWeek', 'last7days'];

/** 这周做到第几次、目标几次：数字块的 goal、按周的连续，或者每个习惯上显示的汇总和目标。 */
function weeklyProgress(v: AppView, table: string): boolean {
  const number = numberBlocks(v, table).some(
    (b) =>
      statInputsFilled(v, b) &&
      ((b.source.goal !== undefined &&
        (b.source.filter ?? []).some(
          (c) => c.op === 'inPeriod' && WEEK_PERIODS.includes(c.value),
        )) ||
        (b.source.aggregate === 'streak' &&
          b.source.days?.unit === 'week' &&
          (b.source.days.perUnit ?? 0) >= 1)),
  );
  if (number) return true;
  return rollupsOver(v, table).some((r) => {
    if (!rollupInputsFilled(v, r)) return false;
    const { field, host } = r;
    if (field.aggregate === 'streak' && field.days?.unit === 'week') return true;
    const inWeek = (field.filter ?? []).some(
      (c) => c.op === 'inPeriod' && WEEK_PERIODS.includes(c.value),
    );
    if (!inWeek) return false;
    return (
      recordBlocks(v, host).some(
        (b) => b.show.trailing === field.id && b.show.format?.kind === 'progress',
      ) ||
      fieldsOf(v, host).some(
        (f) => (f.type === 'number' || f.type === 'rating') && displayed(v, host, f.id),
      )
    );
  });
}

const weeklyStreak = (v: AppView, table: string) =>
  numberBlocks(v, table).some(
    (b) => b.source.aggregate === 'streak' && b.source.days?.unit === 'week',
  ) ||
  rollupsOver(v, table).some(
    (r) => r.field.aggregate === 'streak' && r.field.days?.unit === 'week',
  );

// ---- 待办 ----

/** 把一条标成做完：打勾、或者每一条上的按钮改状态。 */
function markedDoneField(v: AppView, table: string): string | null {
  for (const w of v.writes) {
    if (w.tool.table !== table || !rowExists(v, w) || w.rowOf !== table) continue;
    const { tool } = w;
    if (tool.do === 'toggle' && (w.as === 'check' || w.as === 'button' || w.as === 'tap'))
      return tool.field;
    if (tool.do === 'set' && (w.as === 'button' || w.as === 'tap' || w.as === 'drag'))
      return tool.field;
  }
  return null;
}

/** 标得了做完：改这一条的字段，或者新建一条完成记录。 */
const canMarkDone = (v: AppView, table: string) =>
  markedDoneField(v, table) !== null || completionCreates(v, table).length > 0;

/** 列表能跟着完成记录变的字段：完成表上的汇总，或者最后完成时间读这个汇总的日程。 */
function fieldsFollowingCompletions(v: AppView, table: string): string[] {
  const completions = new Set(completionCreates(v, table).map((w) => w.tool.table));
  const rollups = fieldsOf(v, table).filter((f) => f.type === 'rollup' && completions.has(f.table));
  const ids = rollups.map((f) => f.id);
  return [
    ...ids,
    ...fieldsOf(v, table)
      .filter((f) => f.type === 'schedule' && f.lastDone !== undefined && ids.includes(f.lastDone))
      .map((f) => f.id),
  ];
}

const hidesDone = (v: AppView, table: string) => {
  const field = markedDoneField(v, table);
  const fields = [...(field !== null ? [field] : []), ...fieldsFollowingCompletions(v, table)];
  return recordBlocks(v, table).some(
    (b) =>
      fields.includes(b.source.sort?.field ?? '') ||
      b.source.filter?.some((c) => fields.includes(c.field)),
  );
};

/** 分项目：引用另一张加得进去的表，或者按单选分组。 */
const inProjects = (v: AppView, table: string) =>
  fieldsOf(v, table).some(
    (f) =>
      f.type === 'link' && f.table !== table && canAdd(v, f.table) && entryWrites(v, table, f.id),
  ) ||
  recordBlocks(v, table).some((b) => {
    const by = b.source.group?.by;
    const f = fieldsOf(v, table).find((x) => x.id === by);
    return f?.type === 'choice' && entryWrites(v, table, f.id);
  });

const scheduleFields = (v: AppView, table: string) =>
  fieldsOf(v, table).filter((f) => f.type === 'schedule');

/** 今天要做的放在前面：只列今天的，或者按日程排、分段（今天的在最前）。 */
const todayView = (v: AppView, table: string) =>
  recordBlocks(v, table).some((b) => {
    const { filter, sort, group } = b.source;
    const onSchedule = (id: string | undefined) =>
      scheduleFields(v, table).some((f) => f.id === id);
    return (
      (filter ?? []).some((c) => (c.op === 'due' || c.op === 'inPeriod') && c.value === 'today') ||
      (sort?.direction === 'asc' && onSchedule(sort.field)) ||
      onSchedule(group?.by)
    );
  });

const taskRemindable = (v: AppView, table: string) =>
  v.reminders.some(
    (r) =>
      (('each' in r.when && r.when.each.table === table) ||
        ('before' in r.when && r.when.before.table === table) ||
        'every' in r.when) &&
      reminderReaches(v, r, table),
  );

const doneOnNotificationFor = (v: AppView, table: string) =>
  v.reminders.some((r) => 'each' in r.when && r.when.each.table === table && r.done !== undefined);

const isTodoTable = (v: AppView, table: string) =>
  hasTitleInput(v, table) && scheduleFields(v, table).length > 0;

// ---- 记账 ----

const isSum = (kind: string) => kind === 'sum';

const sumByCategory = (v: AppView, table: string) =>
  numberBlocks(v, table).some(
    (b) => isSum(b.source.aggregate) && b.source.group?.by !== undefined && statInputsFilled(v, b),
  ) ||
  chartBlocks(v, table).some(
    (b) =>
      isSum(b.source.aggregate) &&
      b.source.group.by !== undefined &&
      b.source.group.unit === undefined &&
      statInputsFilled(v, b),
  ) ||
  rollupsOver(v, table).some((r) => isSum(r.field.aggregate) && rollupInputsFilled(v, r));

const sumByMonth = (v: AppView, table: string) =>
  chartBlocks(v, table).some(
    (b) => isSum(b.source.aggregate) && b.source.group.unit === 'month' && statInputsFilled(v, b),
  ) ||
  numberBlocks(v, table).some(
    (b) =>
      isSum(b.source.aggregate) &&
      (b.source.filter ?? []).some((c) => c.op === 'inPeriod' && c.value === 'thisMonth') &&
      statInputsFilled(v, b),
  ) ||
  rollupsOver(v, table).some(
    (r) =>
      isSum(r.field.aggregate) &&
      rollupInputsFilled(v, r) &&
      (r.field.filter ?? []).some((c) => c.op === 'inPeriod' && c.value === 'thisMonth'),
  );

/** 两个分类字段是同一套：引用同一张表，或者单选至少有一个相同的选项。 */
function sameCategories(a: Field, b: Field): boolean {
  if (a.type === 'link' && b.type === 'link') return a.table === b.table;
  if (a.type !== 'choice' || b.type !== 'choice') return false;
  return a.options.some((x) => b.options.some((y) => x.id === y.id || x.label === y.label));
}

/** 独立的目标表：另一张加得进去的表，每条选一个分类（和这张表同一套）、填一个金额。 */
function targetTable(v: AppView, table: string): boolean {
  const categories = fieldsOf(v, table).filter(
    (f) => (f.type === 'choice' || f.type === 'link') && entryWrites(v, table, f.id),
  );
  return tableIds(v).some(
    (other) =>
      other !== table &&
      hasAmountInput(v, other) &&
      fieldsOf(v, other).some(
        (f) => entryWrites(v, other, f.id) && categories.some((c) => sameCategories(c, f)),
      ),
  );
}

/** 每类目标：引用的分类表上有金额字段填得到（或汇总的分配表），独立的目标表，或者按类筛的数字块带目标。 */
const hasTargets = (v: AppView, table: string) =>
  targetTable(v, table) ||
  fieldsOf(v, table).some(
    (f) =>
      f.type === 'link' &&
      canAdd(v, f.table) &&
      fieldsOf(v, f.table).some(
        (g) =>
          ((g.type === 'money' || g.type === 'number') && entryFills(v, f.table, g.id)) ||
          // 零基预算：目标是另一张分配表上汇总出来的。
          (g.type === 'rollup' &&
            g.table !== table &&
            isSum(g.aggregate) &&
            hasAmountInput(v, g.table)),
      ),
  ) ||
  numberBlocks(v, table).some(
    (b) => isSum(b.source.aggregate) && b.source.goal !== undefined && statInputsFilled(v, b),
  );

/** 每类还剩多少：公式（目标 − 汇总）、数字块 minus、带目标的数字块、或者目标进度环。 */
function remaining(v: AppView, table: string): boolean {
  const spentFields = rollupsOverAny(v, table);
  const formula = tablesOf(v.config).some((host) =>
    host.fields.some((f) => {
      if (f.type !== 'formula' || !displayed(v, host.id, f.id)) return false;
      const parsed = parseFormula(f.expression);
      return (
        parsed.ok &&
        parsed.refs.some((id) => spentFields.some((r) => r.host === host.id && r.id === id))
      );
    }),
  );
  if (formula) return true;
  const minus = numberBlocks(v).some(
    (b) =>
      b.source.minus !== undefined &&
      (b.source.table === table || b.source.minus.table === table) &&
      statInputsFilled(v, b),
  );
  if (minus) return true;
  const goal = numberBlocks(v, table).some(
    (b) => isSum(b.source.aggregate) && b.source.goal !== undefined && statInputsFilled(v, b),
  );
  if (goal) return true;
  return rollupsOver(v, table).some(
    (r) =>
      isSum(r.field.aggregate) &&
      recordBlocks(v, r.host).some(
        (b) => b.show.trailing === r.field.id && b.show.format?.kind === 'progress',
      ),
  );
}

/** 汇总 over 这张表的字段（公式读它，自己可以不显示）。 */
const rollupsOverAny = (v: AppView, table: string) =>
  tablesOf(v.config).flatMap((host) =>
    host.fields.flatMap((f) =>
      f.type === 'rollup' && f.table === table && isSum(f.aggregate)
        ? [{ host: host.id, id: f.id }]
        : [],
    ),
  );

// ---- 文件进记录 ----

/**
 * 文件进这张表，用户确认后存：快捷操作交给新记录表单（摆在摸得到的地方），或者表单、完整表单里问附件字段
 * （可以当场拍照、选文件）。只能从收件页面「存成记录」不算：没有入口。
 */
function capturesFile(v: AppView, table: string): boolean {
  if (v.intakes.some((x) => x.table === table && x.placed && x.ok && x.files)) return true;
  return fieldsOf(v, table).some(
    (f) =>
      f.type === 'file' &&
      v.writes.some(
        (w) =>
          w.tool.do === 'create' &&
          w.tool.table === table &&
          w.as !== 'done' &&
          (w.tool.ask === 'all' || (Array.isArray(w.tool.ask) && w.tool.ask.includes(f.id))),
      ),
  );
}

const capturedByCamera = (v: AppView, table: string) =>
  v.intakes.some((x) => x.table === table && x.placed && x.ok && x.camera);

const hasFileField = (v: AppView, table: string) =>
  fieldsOf(v, table).some((f) => f.type === 'file');

const FILE_TABLE = (v: AppView, table: string) => hasFileField(v, table) && capturesFile(v, table);

// ---- 场景（12 个，语言轮换）----

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'habit-simple',
    category: 'habit',
    locale: 'zh',
    setup: 'default',
    opening: '我想每天打卡，点一下就记下今天，能看到一共打了多少天。',
    requirements: [
      {
        id: 'one-tap',
        core: true,
        cap: (v) => oneTapTables(v).size > 0,
        ask: {
          zh: '我想点一下就打卡，不用填东西。',
          en: 'I want to check in with one tap, without filling anything in.',
          fr: 'Je veux pointer en un seul appui, sans rien remplir.',
        },
      },
      {
        id: 'days-count',
        core: true,
        cap: (v) =>
          [...oneTapTables(v)].some(
            (t) =>
              aggregatesOn(v, t, ['count', 'sum', 'distinctDays', 'streak']) ||
              chartBlocks(v, t).some((b) => statInputsFilled(v, b)),
          ),
        ask: {
          zh: '能在页面上看到我打卡的天数吗？',
          en: 'Can I see on the page how many days I checked in?',
          fr: 'Est-ce que je peux voir sur la page combien de jours j’ai pointé ?',
        },
      },
      {
        id: 'history',
        core: false,
        cap: (v) => [...oneTapTables(v)].some((t) => recordBlocks(v, t).length > 0),
        ask: {
          zh: '我还想看到打过卡的那些日子。',
          en: 'I would also like to see the days I checked in.',
          fr: 'Je voudrais aussi voir les jours où j’ai pointé.',
        },
      },
    ],
  },
  {
    id: 'habit-streaks',
    category: 'habit',
    locale: 'en',
    setup: 'default',
    opening:
      'Build me a habit app like Streaks: big circles I tap to check in, a streak count, a reminder at 9pm with a Done button right on the notification.',
    requirements: [
      {
        id: 'circles',
        core: true,
        cap: (v) => recordBlocks(v).some((b) => b.look === 'tiles' && canAdd(v, b.source.table)),
        ask: {
          zh: '习惯要做成大圆块，而且我要能加新的习惯。',
          en: 'Habits should be big circles, and I need to be able to add new habits.',
          fr: 'Les habitudes doivent être de grands cercles, et je dois pouvoir en ajouter.',
        },
      },
      {
        id: 'tap-checks-in',
        core: true,
        cap: (v) => tapWrites(v).length > 0,
        ask: {
          zh: '点一下圆块就应该直接打卡。',
          en: 'Tapping a circle should check in right away.',
          fr: 'Appuyer sur un cercle doit pointer tout de suite.',
        },
      },
      {
        id: 'streak',
        core: true,
        cap: (v) => tapStreakTables(v).length > 0,
        ask: {
          zh: '每个习惯要显示连续多少天，点圆块记下的要算进去。',
          en: 'Show the streak for each habit, counting the check-ins from tapping the circle.',
          fr: 'Affiche la série de chaque habitude, en comptant les pointages faits sur le cercle.',
        },
      },
      {
        id: 'reminder-time',
        core: true,
        cap: (v) =>
          v.reminders.some(
            (r) =>
              reminderTime(r) === '21:00' &&
              tapWrites(v).some(
                (w) =>
                  reminderReaches(v, r, w.tool.table) ||
                  (w.rowOf !== undefined && reminderReaches(v, r, w.rowOf)),
              ),
          ),
        ask: {
          zh: '晚上 9 点提醒我，点提醒打开这些习惯。',
          en: 'Remind me at 9pm, and the reminder should open my habits.',
          fr: 'Rappelle-moi à 21 h, et le rappel doit ouvrir mes habitudes.',
        },
      },
      {
        id: 'done-on-notification',
        core: true,
        cap: (v) =>
          v.reminders.some(
            (r) => r.done !== undefined && tapStreakTables(v).includes(r.done.table),
          ),
        ask: {
          zh: '通知上要有「完成」按钮，点了就算打卡，连续天数也要算上。',
          en: 'The notification needs a Done button that checks in and counts toward the streak.',
          fr: 'La notification doit avoir un bouton Fait qui pointe et compte dans la série.',
        },
      },
      {
        id: 'no-nag',
        core: false,
        cap: (v) => v.reminders.some((r) => r.unless !== undefined),
        ask: {
          zh: '今天已经打过卡就别再提醒了。',
          en: 'Don’t remind me if I already checked in today.',
          fr: 'Ne me rappelle pas si j’ai déjà pointé aujourd’hui.',
        },
      },
    ],
  },
  {
    id: 'habit-weekly-goal',
    category: 'habit',
    locale: 'fr',
    setup: 'default',
    opening:
      'Je veux suivre mes habitudes avec un objectif par semaine : courir 3 fois par semaine, et voir où j’en suis cette semaine.',
    requirements: [
      {
        id: 'log',
        core: true,
        cap: (v) => some(v, (t) => loggable(v, t)),
        ask: {
          zh: '我要能记一次跑步，日期默认今天。',
          en: 'I need to log a run, with the date set to today by default.',
          fr: 'Je dois pouvoir noter une course, avec la date du jour par défaut.',
        },
      },
      {
        id: 'weekly-progress',
        core: true,
        cap: (v) => some(v, (t) => loggable(v, t) && weeklyProgress(v, t)),
        ask: {
          zh: '我想看到这周做了几次、目标是几次。',
          en: 'I want to see how many times I did it this week against the goal.',
          fr: 'Je veux voir combien de fois je l’ai fait cette semaine par rapport à l’objectif.',
        },
      },
      {
        id: 'weekly-streak',
        core: false,
        cap: (v) => some(v, (t) => weeklyStreak(v, t)),
        ask: {
          zh: '再显示连续达标了几周。',
          en: 'Also show how many weeks in a row I hit the goal.',
          fr: 'Affiche aussi combien de semaines d’affilée j’ai atteint l’objectif.',
        },
      },
    ],
  },
  {
    id: 'calendar-mood',
    category: 'calendar',
    locale: 'fr',
    setup: 'default',
    opening:
      'Je veux un journal d’humeur : noter mon humeur chaque jour et voir le mois en calendrier, avec une couleur selon l’humeur.',
    requirements: [
      {
        id: 'log-mood',
        core: true,
        cap: (v) =>
          some(
            v,
            (t) =>
              canAdd(v, t) &&
              fieldsOf(v, t).some(
                (f) => f.type === 'choice' && f.options.length >= 2 && entryWrites(v, t, f.id),
              ),
          ),
        ask: {
          zh: '我要能记下今天的心情，从几种心情里选。',
          en: 'I need to log today’s mood by picking from a few moods.',
          fr: 'Je dois pouvoir noter mon humeur du jour en choisissant parmi quelques humeurs.',
        },
      },
      {
        id: 'month-calendar',
        core: true,
        cap: (v) => some(v, (t) => canAdd(v, t) && calendars(v, t).length > 0),
        ask: {
          zh: '我想按月看，像日历一样。',
          en: 'I want to see it by month, like a calendar.',
          fr: 'Je veux le voir par mois, comme un calendrier.',
        },
      },
      {
        id: 'day-filled',
        core: true,
        cap: (v) => some(v, (t) => canAdd(v, t) && calendarDayFilled(v, t)),
        ask: {
          zh: '记下的心情要落在日历的那一天上，日期默认今天。',
          en: 'A mood I log should land on that day in the calendar; the date should default to today.',
          fr: 'Une humeur notée doit apparaître ce jour-là dans le calendrier ; la date doit être celle du jour par défaut.',
        },
      },
      {
        id: 'mood-color',
        core: true,
        cap: (v) =>
          recordBlocks(v).some(
            (b) =>
              b.look === 'calendar' &&
              b.show.color !== undefined &&
              canAdd(v, b.source.table) &&
              entryWrites(v, b.source.table, b.show.color),
          ),
        ask: {
          zh: '日历上每天按心情显示不同的颜色。',
          en: 'Color each day in the calendar according to the mood.',
          fr: 'Colore chaque jour du calendrier selon l’humeur.',
        },
      },
      {
        id: 'day-note',
        core: false,
        cap: (v) =>
          recordBlocks(v)
            .filter((b) => b.look === 'calendar')
            .some((b) =>
              fieldsOf(v, b.source.table).some(
                (f) =>
                  (f.type === 'text' || f.type === 'note') && entryWrites(v, b.source.table, f.id),
              ),
            ),
        ask: {
          zh: '每天还能写一句话。',
          en: 'I’d like to write a line for each day too.',
          fr: 'J’aimerais aussi écrire une phrase pour chaque jour.',
        },
      },
    ],
  },
  {
    id: 'calendar-medication',
    category: 'calendar',
    locale: 'en',
    setup: 'default',
    opening:
      'Build me a medication calendar: one tap to log that I took my pill, see the month with the days I took it, and remind me every morning at 8.',
    requirements: [
      {
        id: 'one-tap-log',
        core: true,
        cap: (v) => oneTapCreateTables(v).size > 0,
        ask: {
          zh: '点一下就记下今天吃过药，不用填东西。',
          en: 'One tap should log that I took it today, without filling anything in.',
          fr: 'Un seul appui doit noter que je l’ai pris aujourd’hui, sans rien remplir.',
        },
      },
      {
        id: 'month-calendar',
        core: true,
        cap: (v) =>
          [...oneTapCreateTables(v)].some(
            (t) => calendars(v, t).length > 0 && calendarDayFilled(v, t),
          ),
        ask: {
          zh: '我想在月历上看到吃过药的那些天，点一下记的要显示在上面。',
          en: 'I want to see the days I took it on a month calendar, including what I log with one tap.',
          fr: 'Je veux voir les jours où je l’ai pris sur un calendrier du mois, y compris ce que je note en un appui.',
        },
      },
      {
        id: 'reminder-time',
        core: true,
        cap: (v) =>
          v.reminders.some(
            (r) =>
              reminderTime(r) === '08:00' &&
              [...oneTapCreateTables(v)].some((t) => reminderReaches(v, r, t)),
          ),
        ask: {
          zh: '每天早上 8 点提醒我，点提醒能打开记录吃药的页面。',
          en: 'Remind me every morning at 8, and the reminder should open the page where I log it.',
          fr: 'Rappelle-moi chaque matin à 8 h, et le rappel doit ouvrir la page où je le note.',
        },
      },
      {
        id: 'done-on-notification',
        core: false,
        cap: (v) =>
          v.reminders.some(
            (r) =>
              r.done !== undefined &&
              r.done.do === 'create' &&
              calendars(v, r.done.table).length > 0,
          ),
        ask: {
          zh: '通知上加个「吃了」按钮，点了就记到日历上。',
          en: 'Add a “Taken” button on the notification that logs it on the calendar.',
          fr: 'Ajoute un bouton « Pris » sur la notification qui le note dans le calendrier.',
        },
      },
      {
        id: 'no-nag',
        core: false,
        cap: (v) => v.reminders.some((r) => r.unless !== undefined),
        ask: {
          zh: '今天记过了就别再提醒。',
          en: 'Don’t remind me if I already logged it today.',
          fr: 'Ne me rappelle pas si je l’ai déjà noté aujourd’hui.',
        },
      },
    ],
  },
  {
    id: 'todo-simple',
    category: 'todo',
    locale: 'fr',
    setup: 'default',
    opening: 'Une simple liste de choses à faire : ajouter une tâche, la cocher quand c’est fait.',
    requirements: [
      {
        id: 'add-task',
        core: true,
        cap: (v) => some(v, (t) => hasTitleInput(v, t)),
        ask: {
          zh: '我要能加一条待办，写上要做的事。',
          en: 'I need to add a task by typing what to do.',
          fr: 'Je dois pouvoir ajouter une tâche en écrivant ce qu’il y a à faire.',
        },
      },
      {
        id: 'check-off',
        core: true,
        cap: (v) => some(v, (t) => hasTitleInput(v, t) && canMarkDone(v, t)),
        ask: {
          zh: '每条待办要能直接勾掉。',
          en: 'I should be able to check off each task right in the list.',
          fr: 'Je dois pouvoir cocher chaque tâche directement dans la liste.',
        },
      },
      {
        id: 'hide-done',
        core: false,
        cap: (v) => some(v, (t) => hidesDone(v, t)),
        ask: {
          zh: '做完的放到后面或者藏起来。',
          en: 'Move finished tasks to the end, or hide them.',
          fr: 'Mets les tâches terminées à la fin, ou cache-les.',
        },
      },
    ],
  },
  {
    id: 'todo-todoist',
    category: 'todo',
    locale: 'zh',
    setup: 'default',
    opening:
      '做一个我自己的待办，像 Todoist：分项目，任务可以一次或重复，今天要做的放最前面，重复的做完自动排下次，到点提醒。',
    requirements: [
      {
        id: 'add-task',
        core: true,
        cap: (v) => some(v, (t) => isTodoTable(v, t)),
        ask: {
          zh: '我要能加一条任务，写上标题，还能设日期或重复。',
          en: 'I need to add a task with a title and set a date or a repeat.',
          fr: 'Je dois pouvoir ajouter une tâche avec un titre et définir une date ou une répétition.',
        },
      },
      {
        id: 'projects',
        core: true,
        cap: (v) => some(v, (t) => isTodoTable(v, t) && inProjects(v, t)),
        ask: {
          zh: '任务要能分到项目里，项目我自己加。',
          en: 'Tasks should belong to projects, and I can add my own projects.',
          fr: 'Les tâches doivent appartenir à des projets, et je peux ajouter mes propres projets.',
        },
      },
      {
        id: 'once-or-repeat',
        core: true,
        cap: (v) =>
          some(
            v,
            (t) => hasTitleInput(v, t) && scheduleFields(v, t).some((f) => entryAsks(v, t, f.id)),
          ),
        ask: {
          zh: '加任务的时候要能选只做一次还是重复。',
          en: 'When adding a task I should be able to choose once or repeating.',
          fr: 'En ajoutant une tâche, je dois pouvoir choisir une seule fois ou répétée.',
        },
      },
      {
        id: 'today-view',
        core: true,
        cap: (v) => some(v, (t) => isTodoTable(v, t) && todayView(v, t)),
        ask: {
          zh: '今天该做的要放在最前面，或者单独一个「今天」的列表。',
          en: 'Put what is due today first, or give it its own Today list.',
          fr: 'Mets ce qui est à faire aujourd’hui en premier, ou fais-en une liste Aujourd’hui.',
        },
      },
      {
        id: 'done-reschedules',
        core: true,
        cap: (v) => some(v, (t) => isTodoTable(v, t) && completionReschedules(v, t)),
        ask: {
          zh: '点完成之后，重复的任务要自动排到下一次。',
          en: 'After I mark a repeating task done, it should move to its next date.',
          fr: 'Quand je marque une tâche répétée comme faite, elle doit passer à sa prochaine date.',
        },
      },
      {
        id: 'reminder',
        core: true,
        cap: (v) => some(v, (t) => isTodoTable(v, t) && taskRemindable(v, t)),
        ask: {
          zh: '任务到点要提醒我，点提醒打开任务。',
          en: 'Remind me when a task is due, and the reminder should open my tasks.',
          fr: 'Rappelle-moi quand une tâche arrive à échéance, et le rappel doit ouvrir mes tâches.',
        },
      },
      {
        id: 'done-on-notification',
        core: false,
        cap: (v) => some(v, (t) => isTodoTable(v, t) && doneOnNotificationFor(v, t)),
        ask: {
          zh: '通知上加个「完成」按钮。',
          en: 'Add a Done button on the notification.',
          fr: 'Ajoute un bouton Fait sur la notification.',
        },
      },
    ],
  },
  {
    id: 'todo-board',
    category: 'todo',
    locale: 'en',
    setup: 'default',
    opening:
      'I want a kanban board for my tasks: columns for to do, doing and done, drag cards between columns, and add new cards.',
    requirements: [
      {
        id: 'board',
        core: true,
        cap: (v) => recordBlocks(v).some((b) => b.look === 'board'),
        ask: {
          zh: '我要的是看板，一列一个状态。',
          en: 'I want a board with one column per status.',
          fr: 'Je veux un tableau avec une colonne par statut.',
        },
      },
      {
        id: 'drag',
        core: true,
        cap: (v) =>
          v.writes.some(
            (w) =>
              w.as === 'drag' &&
              w.tool.do === 'set' &&
              w.block?.block.look === 'board' &&
              w.tool.field === w.block.block.source.group?.by,
          ),
        ask: {
          zh: '卡片要能在列之间拖动。',
          en: 'I should be able to drag cards between the columns.',
          fr: 'Je dois pouvoir faire glisser les cartes entre les colonnes.',
        },
      },
      {
        id: 'add-card',
        core: true,
        cap: (v) =>
          recordBlocks(v).some((b) => b.look === 'board' && hasTitleInput(v, b.source.table)),
        ask: {
          zh: '我要能在看板上加新卡片。',
          en: 'I need to add new cards to the board.',
          fr: 'Je dois pouvoir ajouter de nouvelles cartes au tableau.',
        },
      },
      {
        id: 'new-card-column',
        core: false,
        cap: (v) =>
          recordBlocks(v).some(
            (b) =>
              b.look === 'board' &&
              b.source.group?.by !== undefined &&
              createFills(v, b.source.table, b.source.group.by),
          ),
        ask: {
          zh: '新卡片默认放在「待办」那一列。',
          en: 'New cards should start in the to-do column.',
          fr: 'Les nouvelles cartes doivent commencer dans la colonne à faire.',
        },
      },
    ],
  },
  {
    id: 'money-ledger',
    category: 'money',
    locale: 'fr',
    setup: 'default',
    opening: 'Je veux noter mes dépenses, et voir le total par catégorie et par mois.',
    requirements: [
      {
        id: 'log',
        core: true,
        cap: (v) => some(v, (t) => hasAmountInput(v, t) && hasCategoryInput(v, t)),
        ask: {
          zh: '我要能记一笔：金额和分类。',
          en: 'I need to log an expense with an amount and a category.',
          fr: 'Je dois pouvoir noter une dépense avec un montant et une catégorie.',
        },
      },
      {
        id: 'by-category',
        core: true,
        cap: (v) => some(v, (t) => hasAmountInput(v, t) && sumByCategory(v, t)),
        ask: {
          zh: '我想看每个分类一共花了多少。',
          en: 'I want to see the total spent per category.',
          fr: 'Je veux voir le total dépensé par catégorie.',
        },
      },
      {
        id: 'by-month',
        core: true,
        cap: (v) => some(v, (t) => hasAmountInput(v, t) && sumByMonth(v, t)),
        ask: {
          zh: '我想看每个月花了多少。',
          en: 'I want to see how much I spent per month.',
          fr: 'Je veux voir combien j’ai dépensé par mois.',
        },
      },
      {
        id: 'entries',
        core: false,
        cap: (v) => some(v, (t) => hasAmountInput(v, t) && recordBlocks(v, t).length > 0),
        ask: {
          zh: '我还想看到每一笔的列表。',
          en: 'I’d also like to see the list of expenses.',
          fr: 'J’aimerais aussi voir la liste des dépenses.',
        },
      },
    ],
  },
  {
    id: 'money-budget',
    category: 'money',
    locale: 'zh',
    setup: 'default',
    opening: '做个预算：每个分类有每月目标，记每一笔支出，看每类还剩多少。',
    requirements: [
      {
        id: 'log-spend',
        core: true,
        cap: (v) => some(v, (t) => hasAmountInput(v, t) && hasCategoryInput(v, t)),
        ask: {
          zh: '我要能记一笔支出，填金额、选分类。',
          en: 'I need to log an expense with an amount and a category.',
          fr: 'Je dois pouvoir noter une dépense avec un montant et une catégorie.',
        },
      },
      {
        id: 'targets',
        core: true,
        cap: (v) => some(v, (t) => hasAmountInput(v, t) && hasTargets(v, t)),
        ask: {
          zh: '每个分类要能设一个每月目标金额。',
          en: 'Each category needs its own monthly target amount.',
          fr: 'Chaque catégorie doit avoir son propre montant cible mensuel.',
        },
      },
      {
        id: 'remaining',
        core: true,
        cap: (v) =>
          some(v, (t) => hasAmountInput(v, t) && hasCategoryInput(v, t) && remaining(v, t)),
        ask: {
          zh: '每个分类要显示还剩多少。',
          en: 'Show how much is left in each category.',
          fr: 'Affiche ce qu’il reste dans chaque catégorie.',
        },
      },
    ],
  },
  {
    id: 'file-receipt',
    category: 'fileToRecord',
    locale: 'zh',
    setup: 'default',
    opening: '拍小票记账：拍一下，确认金额和分类就存进去，小票照片留在这条记录上。',
    requirements: [
      {
        id: 'capture',
        core: true,
        cap: (v) => some(v, (t) => FILE_TABLE(v, t)),
        ask: {
          zh: '我要一个摸得到的按钮，拍小票后打开表单，确认了再存，照片存在这条记录上。',
          en: 'I want a button I can reach that takes a photo of the receipt, opens the form to confirm, and keeps the photo on the entry.',
          fr: 'Je veux un bouton accessible qui photographie le ticket, ouvre le formulaire pour confirmer et garde la photo sur l’entrée.',
        },
      },
      {
        id: 'amount-category',
        core: true,
        cap: (v) =>
          some(v, (t) => FILE_TABLE(v, t) && hasAmountInput(v, t) && hasCategoryInput(v, t)),
        ask: {
          zh: '表单里要能填金额、选分类。',
          en: 'The form should let me enter the amount and pick a category.',
          fr: 'Le formulaire doit me laisser saisir le montant et choisir une catégorie.',
        },
      },
      {
        id: 'view',
        core: true,
        cap: (v) => some(v, (t) => FILE_TABLE(v, t) && recordBlocks(v, t).length > 0),
        ask: {
          zh: '存好的账要能在页面上看到。',
          en: 'I want to see the saved expenses on a page.',
          fr: 'Je veux voir les dépenses enregistrées sur une page.',
        },
      },
      {
        id: 'camera',
        core: false,
        cap: (v) => some(v, (t) => capturedByCamera(v, t)),
        ask: {
          zh: '按钮直接打开相机或扫描。',
          en: 'The button should open the camera or the scanner directly.',
          fr: 'Le bouton doit ouvrir directement l’appareil photo ou le scanner.',
        },
      },
      {
        id: 'monthly',
        core: false,
        cap: (v) => some(v, (t) => FILE_TABLE(v, t) && sumByMonth(v, t)),
        ask: {
          zh: '还想看每个月花了多少。',
          en: 'I’d also like to see how much I spent each month.',
          fr: 'J’aimerais aussi voir combien j’ai dépensé chaque mois.',
        },
      },
    ],
  },
  {
    id: 'file-contract',
    category: 'fileToRecord',
    locale: 'en',
    setup: 'default',
    opening:
      'Scan contracts into an archive: scan a contract, check the details and save it with the file, then browse them later.',
    requirements: [
      {
        id: 'capture',
        core: true,
        cap: (v) => some(v, (t) => FILE_TABLE(v, t)),
        ask: {
          zh: '我要一个摸得到的按钮，扫描合同后打开表单，确认了再存，文件存在这条记录上。',
          en: 'I want a button I can reach that scans a contract, opens the form to confirm, and keeps the file on the entry.',
          fr: 'Je veux un bouton accessible qui numérise un contrat, ouvre le formulaire pour confirmer et garde le fichier sur l’entrée.',
        },
      },
      {
        id: 'details',
        core: true,
        cap: (v) => some(v, (t) => FILE_TABLE(v, t) && hasTitleInput(v, t)),
        ask: {
          zh: '表单里要能填合同名称。',
          en: 'The form should let me enter the contract’s name.',
          fr: 'Le formulaire doit me laisser saisir le nom du contrat.',
        },
      },
      {
        id: 'browse',
        core: true,
        cap: (v) => some(v, (t) => FILE_TABLE(v, t) && recordBlocks(v, t).length > 0),
        ask: {
          zh: '存好的合同要能翻看。',
          en: 'I want to browse the saved contracts.',
          fr: 'Je veux parcourir les contrats enregistrés.',
        },
      },
      {
        id: 'scanner',
        core: false,
        cap: (v) => some(v, (t) => capturedByCamera(v, t)),
        ask: {
          zh: '按钮直接打开扫描。',
          en: 'The button should open the scanner directly.',
          fr: 'Le bouton doit ouvrir directement le scanner.',
        },
      },
      {
        id: 'expiry-reminder',
        core: false,
        cap: (v) =>
          v.reminders.some((r) => 'before' in r.when && FILE_TABLE(v, r.when.before.table)),
        ask: {
          zh: '合同到期前提醒我。',
          en: 'Remind me before a contract expires.',
          fr: 'Rappelle-moi avant l’expiration d’un contrat.',
        },
      },
    ],
  },
];
