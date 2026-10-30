import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { createStarterWorkspace } from './starter';
import type { Op } from './ops-schema';
import { SAMPLE_APPS, sampleInfo, sampleOps, type SampleApp } from './samples';
import {
  HOME_PAGE_ID,
  allComponents,
  isKnownComponent,
  quickActionsOf,
  remindersOf,
  type Locale,
  type WorkspaceConfig,
} from './schema';
import { apply, fromV33, registry, v33Fixture, workspace } from './test-helpers';
import { validateWorkspace } from './validate';
import { presetById, presetWorkflow } from './workflows/presets';

// 样板 App（samples/*.json，D-260）：每个样板在三种语言下，对新用户、已有同名表和页面、导航栏已满、
// 接近上限的配置套用，结果都要通过校验；引用都指向换过的 ID；预设展开后和用户自己添加时一样。

const LOCALES: Locale[] = ['en', 'zh', 'fr'];

function ops(sample: SampleApp, config: WorkspaceConfig, locale: Locale): Op[] {
  const result = sampleOps(sample, config, locale);
  if (!result.ok) throw new Error(result.message);
  return result.ops;
}

/** 新用户：引导前的首页是空的，导航栏只有首页、AI、设置。 */
const fresh = (locale: Locale) => createStarterWorkspace(locale, registry);

/** 已经有和样板同名的表、页面、快捷操作、提醒：先套用一次同一个样板（再加上它会用到的预设 ID）。 */
function crowded(sample: SampleApp, locale: Locale): WorkspaceConfig {
  const base = fresh(locale);
  return apply(base, ops(sample, base, locale), locale);
}

/** 导航栏已满（默认工作空间：首页、工具、AI、历史、设置）。 */
const navFull = (locale: Locale) => workspace(locale);

/** 加上几张表和几个页面，让表和页面都只剩 room 个空位。 */
function nearLimit(locale: Locale, room: { tables: number; pages: number }): WorkspaceConfig {
  let config = fresh(locale);
  const extra: Op[] = [];
  for (let i = config.data.tables.length; i < 20 - room.tables; i++)
    extra.push({
      op: 'addData',
      table: {
        id: `t${i}`,
        name: `T${i}`,
        fields: [{ id: 'name', name: 'Name', type: 'text' }],
      },
    });
  for (let i = config.containers.pages.length; i < 20 - room.pages; i++)
    extra.push({
      op: 'addContainer',
      page: {
        id: `p${i}`,
        title: `P${i}`,
        blocks: [{ id: 'h', look: 'header', show: { title: `P${i}` } }],
      },
    });
  config = apply(config, extra, locale);
  return config;
}

const added = (before: WorkspaceConfig, after: WorkspaceConfig) => ({
  tables: new Set(
    after.data.tables
      .filter((c) => !before.data.tables.some((x) => x.id === c.id))
      .map((c) => c.id),
  ),
  pages: new Set(
    after.containers.pages
      .filter((p) => !before.containers.pages.some((x) => x.id === p.id))
      .map((p) => p.id),
  ),
  workflows: new Set(
    quickActionsOf(after)
      .filter((w) => !before.tools.some((x) => x.id === w.id))
      .map((w) => w.id),
  ),
  reminders: remindersOf(after).filter((r) => !before.tools.some((x) => x.id === r.id)),
});

/**
 * 一段配置 JSON 里所有的引用：表（table、when.before / each 里的 table、步骤参数的 collectionId）、
 * 快捷操作（{tool: id}，$pick.* 除外）、page:x、tool:x。
 */
function refsIn(
  value: unknown,
  out = { tables: [] as string[], pages: [] as string[], workflows: [] as string[] },
) {
  if (Array.isArray(value)) value.forEach((v) => refsIn(v, out));
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'table' || k === 'collectionId') && typeof v === 'string') {
        if (!v.startsWith('$')) out.tables.push(v);
      } else if (k === 'tool' && typeof v === 'string') {
        if (!v.startsWith('$')) out.workflows.push(v);
      } else if (typeof v === 'string' && v.startsWith('page:')) out.pages.push(v.slice(5));
      else if (typeof v === 'string' && v.startsWith('tool:')) out.workflows.push(v.slice(5));
      else refsIn(v, out);
    }
  }
  return out;
}

function expectValid(config: WorkspaceConfig) {
  const valid = validateWorkspace(config, registry);
  expect(valid.ok ? [] : valid.issues).toEqual([]);
}

describe.each(SAMPLE_APPS)('sample %s', (sample) => {
  describe.each(LOCALES)('in %s', (locale) => {
    const cases: [string, () => WorkspaceConfig][] = [
      ['a new user', () => fresh(locale)],
      ['a config that already has its tables and pages', () => crowded(sample, locale)],
      ['a full navigation bar', () => navFull(locale)],
      ['a config with exactly enough room', () => nearLimit(locale, { tables: 2, pages: 3 })],
    ];

    it.each(cases)('applies to %s and validates', (_name, make) => {
      const before = make();
      const result = sampleOps(sample, before, locale);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const after = apply(before, result.ops, locale);
      expectValid(after);
      // App 走的路：一次修改最多 30 个操作，解析、套用、校验都要过（prepareOps）。
      const prepared = prepareOps(before, result.ops, { registry, locale, now: new Date() });
      expect(prepared.ok ? [] : prepared.issues).toEqual([]);

      // 用户看到的文字都换成了这种语言，没有留下 { en, zh, fr } 或占位符（$files、$row 这类是配置里的词，不是占位符）。
      expect(JSON.stringify(after)).not.toMatch(/"en":|\$(table|page|tool)\./);
      // 不改风格主题（D-260）。
      expect(after.theme).toEqual(before.theme);

      const fresh = added(before, after);
      expect(fresh.pages.has(result.mainPageId)).toBe(true);
      // 新加的内容引用的表、页面、快捷操作，都是这次新加的（换过的 ID），不会指到原来同名的那个上。
      const content = [
        ...after.data.tables.filter((c) => fresh.tables.has(c.id)),
        ...after.containers.pages.filter((p) => fresh.pages.has(p.id)),
        ...quickActionsOf(after).filter((w) => fresh.workflows.has(w.id)),
        ...fresh.reminders,
      ];
      const refs = refsIn(content);
      expect(refs.tables.length).toBeGreaterThan(0);
      for (const id of refs.tables) expect(fresh.tables).toContain(id);
      for (const id of refs.pages) expect(fresh.pages).toContain(id);
      for (const id of refs.workflows) expect(fresh.workflows).toContain(id);
      // 每个新加的快捷操作都在样板的页面上有入口。
      const runners = new Set(refs.workflows);
      for (const id of fresh.workflows) expect(runners).toContain(id);

      // 主页面有入口：导航栏有空位就在导航栏，满了就在首页加一个快捷入口。
      const target = `page:${result.mainPageId}`;
      const home = after.containers.pages.find((p) => p.id === HOME_PAGE_ID)!;
      const onHome = allComponents(home).some(
        (c) => isKnownComponent(c) && c.look === 'entry' && c.opens === target,
      );
      if (before.nav.bar.length < 5) {
        expect(after.nav.bar).toContain(target);
        expect(after.nav.bar.at(-1)).toBe('settings');
      } else {
        expect(after.nav.bar).toEqual(before.nav.bar);
        expect(onHome).toBe(true);
      }
      // 首页的组件引用也都是新的。
      const homeRefs = refsIn(
        allComponents(home).filter(
          (c) =>
            !allComponents(before.containers.pages.find((p) => p.id === HOME_PAGE_ID)!).some(
              (x) => x.id === c.id,
            ),
        ),
      );
      for (const id of homeRefs.workflows) expect(fresh.workflows).toContain(id);
      for (const id of homeRefs.pages) expect(fresh.pages).toContain(id);
    });

    it('expands presets exactly like adding them yourself', () => {
      for (const make of [() => fresh(locale), () => crowded(sample, locale)]) {
        const before = make();
        for (const op of ops(sample, before, locale)) {
          if (op.op !== 'addTool' || typeof op.tool === 'string') continue;
          if (op.tool.kind !== 'quickAction' || !op.tool.preset) continue;
          const preset = presetById(op.tool.preset)!;
          expect(op.tool).toEqual(presetWorkflow(preset, locale, op.tool.id));
        }
      }
    });

    it('uses new ids when the old ones are taken', () => {
      const once = crowded(sample, locale);
      const before = fresh(locale);
      const first = added(before, once);
      const twice = apply(once, ops(sample, once, locale), locale);
      const second = added(once, twice);
      expect(second.tables.size).toBe(first.tables.size);
      expect(second.pages.size).toBe(first.pages.size);
      expect(second.workflows.size).toBe(first.workflows.size);
      expect(second.reminders.length).toBe(first.reminders.length);
      for (const id of second.tables) expect(first.tables.has(id)).toBe(false);
      for (const id of second.pages) expect(first.pages.has(id)).toBe(false);
      // 两次都放进了导航栏（新用户的导航栏有两个空位）。
      expect(twice.nav.bar).toHaveLength(5);
    });

    it('refuses with a reason when the tables or pages do not fit', () => {
      const name = sampleInfo(sample, locale).name;
      const tables = sampleOps(sample, nearLimit(locale, { tables: 0, pages: 10 }), locale);
      expect(tables).toMatchObject({ ok: false, problem: 'tables' });
      if (!tables.ok) expect(tables.message).toContain(name);
      const pages = sampleOps(sample, nearLimit(locale, { tables: 10, pages: 0 }), locale);
      expect(pages).toMatchObject({ ok: false, problem: 'pages' });
      if (!pages.ok) expect(pages.message).toContain(name);
    });
  });
});

describe('sample files', () => {
  it('every text has all three languages and every list entry has a name and a summary', () => {
    for (const sample of SAMPLE_APPS) {
      for (const locale of LOCALES) {
        const info = sampleInfo(sample, locale);
        expect(info.name.length).toBeGreaterThan(0);
        expect(info.summary.length).toBeGreaterThan(0);
      }
      // 三种语言出来的配置结构一样，只有文字不同（预设展开的步骤本来就按语言不同，例如翻译成哪种语言）。
      const shape = (locale: Locale) =>
        JSON.stringify(
          ops(sample, fresh(locale), locale).filter(
            (op) =>
              op.op !== 'addTool' ||
              typeof op.tool === 'string' ||
              op.tool.kind !== 'quickAction' ||
              !op.tool.preset,
          ),
          (_k, v: unknown) => (typeof v === 'string' && !/^[a-z0-9:-]+$/.test(v) ? 'TEXT' : v),
        );
      // 英文用 Letter 纸，中文和法语用 A4。
      expect(shape('fr')).toBe(shape('zh'));
    }
  });

  it('the five samples use different main page ids', () => {
    let config = fresh('zh');
    const mains = new Set<string>();
    for (const sample of SAMPLE_APPS) {
      const result = sampleOps(sample, config, 'zh');
      if (!result.ok) throw new Error(result.message);
      mains.add(result.mainPageId);
      config = apply(config, result.ops, 'zh');
    }
    expect(mains.size).toBe(5);
    expectValid(config);
    // 导航栏满了以后，后面的样板的主页面放在首页的快捷入口里。
    expect(config.nav.bar).toHaveLength(5);
  });

  it('refuses when the reminders or the home page are full', () => {
    let config = fresh('en');
    const reminders: Op[] = Array.from({ length: 20 }, (_, i) => ({
      op: 'addTool',
      tool: {
        id: `r${i}`,
        kind: 'reminder',
        title: 'R',
        enabled: false,
        when: { every: 'day', at: '09:00' },
        opens: 'page:home',
      },
    }));
    config = apply(config, reminders, 'en');
    expect(sampleOps('baby-growth', config, 'en')).toMatchObject({
      ok: false,
      problem: 'reminders',
    });

    let full = navFull('en');
    const fill: Op[] = [];
    const home = full.containers.pages.find((p) => p.id === HOME_PAGE_ID)!;
    for (let i = home.blocks.length; i < 30; i++)
      fill.push({
        op: 'addContainer',
        page: HOME_PAGE_ID,
        block: { id: `d${i}`, look: 'divider' },
      });
    full = apply(full, fill, 'en');
    expect(sampleOps('baby-growth', full, 'en')).toMatchObject({ ok: false, problem: 'home' });
  });
});

describe('samples equal the v33 samples, migrated', () => {
  // fixtures/v33/sample-<id>-zh.json：v33 代码给新用户（starter）套用样板的结果。
  it.each(SAMPLE_APPS)('%s in zh', (sample) => {
    const before = fresh('zh');
    expect(apply(before, ops(sample, before, 'zh'), 'zh')).toEqual(
      fromV33(v33Fixture(`sample-${sample}-zh`)),
    );
  });

  it('a reminder whose id a quick action already uses gets a new id (one id space, M1)', () => {
    const base = fresh('zh');
    const taken = apply(
      base,
      [
        {
          op: 'addTool',
          tool: {
            id: 'submit-expenses',
            kind: 'quickAction',
            name: 'X',
            steps: [{ id: 'a', action: 'in.files', params: {} }],
          },
        },
      ],
      'zh',
    );
    const result = sampleOps('expense-helper', taken, 'zh');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = apply(taken, result.ops, 'zh');
    const ids = after.tools.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(remindersOf(after).map((r) => r.id)).toEqual(['submit-expenses-2']);
  });
});
