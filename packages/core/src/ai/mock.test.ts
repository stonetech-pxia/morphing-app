import { describe, expect, it } from 'vitest';

import { prepareOps } from '../change';
import type { Locale, WorkspaceConfig } from '../schema';
import { apply, registry, workspace } from '../test-helpers';
import { createMockAIProvider } from './mock';
import type { Plan } from './types';

// 每个用例对应 docs/MOCK_AI_PHRASES.md 中的一个句式 ID。

const ai = createMockAIProvider();
const now = new Date(2026, 9, 22, 9, 0);

async function plan(input: string, config: WorkspaceConfig, locale: Locale = 'zh'): Promise<Plan> {
  return ai.plan(input, { config, registry, locale });
}

/** 让 mock 生成计划，并通过与 App 相同的 prepareOps 流程得到修改后的配置。 */
async function change(input: string, config: WorkspaceConfig, locale: Locale = 'zh') {
  const p = await plan(input, config, locale);
  if (p.kind !== 'ops') throw new Error(`expected ops for “${input}”, got ${JSON.stringify(p)}`);
  const prepared = prepareOps(config, p.ops, { registry, locale, now });
  if (!prepared.ok) throw new Error(`invalid change for “${input}”: ${prepared.issues.join('; ')}`);
  return prepared;
}

const home = (c: WorkspaceConfig) => c.pages.find((p) => p.id === 'home')!;
const homeIds = (c: WorkspaceConfig) => home(c).components.map((x) => x.id);
const mergeSteps = (c: WorkspaceConfig) => c.workflows.find((w) => w.id === 'pdf-merge')!.steps;

// PDF 不在最上面的首页，这样“放到最上面”是一次真实的修改。
const pdfBelowFiles = () =>
  apply(workspace('zh', { withPdf: true }), [
    { op: 'moveComponent', pageId: 'home', componentId: 'card-pdf', toIndex: 3 },
  ]);

describe('mock AI — journey A (home page)', () => {
  it('A1 full sentence: title, PDF on top, nav trimmed (AI and History stay in Settings)', async () => {
    const { after, lines } = await change(
      '把首页改成文件工作台，把 PDF 放到最上面，导航栏只保留首页、工具、设置。',
      pdfBelowFiles(),
    );
    expect(home(after).title).toBe('文件工作台');
    expect(home(after).components[0]).toMatchObject({
      type: 'header',
      props: { title: '文件工作台' },
    });
    expect(homeIds(after)).toEqual(['welcome', 'card-pdf', 'catalog', 'recent-files']);
    expect(after.shell.nav).toEqual(['page:home', 'tools', 'settings']);
    expect(after.shell.floating).toEqual([]);
    expect(lines).toContain('修改标题「我的工作台」：标题改为「文件工作台」');
  });

  it('A2 “PDF 放第一个”', async () => {
    expect(homeIds((await change('PDF 放第一个', pdfBelowFiles())).after)[1]).toBe('card-pdf');
  });

  it('A3 “导航只要首页、工具和设置”', async () => {
    const { after } = await change('导航只要首页、工具和设置', workspace());
    expect(after.shell.nav).toEqual(['page:home', 'tools', 'settings']);
  });

  it('A4 “首页改成文件工作台”', async () => {
    expect(home((await change('首页改成文件工作台', workspace())).after).title).toBe('文件工作台');
  });

  it('A5 “Put PDF at the top”', async () => {
    expect(homeIds((await change('Put PDF at the top', pdfBelowFiles(), 'en')).after)[1]).toBe(
      'card-pdf',
    );
  });

  it('A6 “Only keep Home, Tools and Settings in the navigation”', async () => {
    const { after } = await change(
      'Only keep Home, Tools and Settings in the navigation',
      workspace('en'),
      'en',
    );
    expect(after.shell.nav).toEqual(['page:home', 'tools', 'settings']);
    expect(after.shell.floating).toEqual([]);
  });

  it('PDF already on top is not a change', async () => {
    expect(await plan('把 PDF 放到最上面', workspace('zh', { withPdf: true }))).toMatchObject({
      kind: 'reject',
      reason: 'noChange',
    });
  });

  it('mentions of an uninstalled tool are rejected with a hint', async () => {
    expect(await plan('把 PDF 放到最上面', workspace())).toMatchObject({
      kind: 'reject',
      reason: 'notInstalled',
    });
  });
});

describe('mock AI — single changes', () => {
  it('B1 theme color', async () => {
    expect((await change('主题换成绿色', workspace())).after.theme.primaryColor).toBe('#2F9E44');
    expect((await change('主题色改成蓝色', workspace())).after.theme.primaryColor).toBe('#1C7ED6');
  });

  it('B2 dark mode', async () => {
    expect((await change('切换到深色模式', workspace())).after.theme.mode).toBe('dark');
  });

  it('B3 hide and show the welcome card', async () => {
    const hidden = (await change('隐藏欢迎卡片', workspace())).after;
    expect(home(hidden).components[0]!.hidden).toBe(true);
    expect(
      home((await change('显示欢迎卡片', hidden)).after).components[0]!.hidden,
    ).toBeUndefined();
  });

  it('B4 “把最近文件放到 PDF 前面”', async () => {
    const { after } = await change('把最近文件放到 PDF 前面', workspace('zh', { withPdf: true }));
    expect(homeIds(after)).toEqual(['welcome', 'recent-files', 'card-pdf', 'catalog']);
  });
});

describe('mock AI — style', () => {
  it('B5/B6 text size', async () => {
    const bigger = (await change('字体大一点', workspace())).after;
    expect(bigger.theme.fontScale).toBe(1.15);
    expect((await change('Bigger text', workspace('en'), 'en')).after.theme.fontScale).toBe(1.15);
    expect((await change('字小一点', workspace())).after.theme.fontScale).toBe(0.9);
    // 已到上限时不再修改。
    const max = apply(workspace(), [{ op: 'setTheme', fontScale: 1.3 }]);
    expect(await plan('字体大一点', max)).toMatchObject({ kind: 'reject', reason: 'noChange' });
  });

  it('B7 corners', async () => {
    expect((await change('圆角小一点', workspace())).after.theme.radius).toBe(14);
    expect((await change('去掉圆角', workspace())).after.theme.radius).toBe(0);
    expect((await change('圆角大一点', workspace())).after.theme.radius).toBe(28);
  });

  it('B8 density', async () => {
    expect((await change('紧凑一点', workspace())).after.theme.density).toBe('compact');
    expect((await change('宽松一点', workspace())).after.theme.density).toBe('spacious');
  });

  it('B9 card style', async () => {
    expect((await change('去掉阴影', workspace())).after.theme.cardStyle).toBe('flat');
    expect((await change('卡片加边框', workspace())).after.theme.cardStyle).toBe('outline');
    expect((await change('卡片改成新粗野风格', workspace())).after.theme.cardStyle).toBe('brutal');
    expect((await change('卡片换成新拟物', workspace())).after.theme.cardStyle).toBe('soft');
    expect((await change('卡片用黏土质感', workspace())).after.theme.cardStyle).toBe('puffy');
    expect((await change('Neumorphic cards', workspace('en'), 'en')).after.theme.cardStyle).toBe(
      'soft',
    );
    expect((await change('卡片改成毛玻璃', workspace())).after.theme.cardStyle).toBe('glass');
    expect((await change('卡片改成霓虹发光', workspace())).after.theme.cardStyle).toBe('glow');
    expect((await change('卡片换成金属质感', workspace())).after.theme.cardStyle).toBe('chrome');
  });

  it('B9d page backdrop', async () => {
    expect((await change('背景改成极光', workspace())).after.theme.backdrop).toBe('aurora');
    expect((await change('页面背景换成渐变', workspace())).after.theme.backdrop).toBe('gradient');
    expect((await change('Aurora background', workspace('en'), 'en')).after.theme.backdrop).toBe(
      'aurora',
    );
  });

  it('B10 navigation bar style', async () => {
    expect((await change('导航栏只显示图标', workspace())).after.theme.navStyle).toBe('icon');
    expect((await change('导航栏只显示文字', workspace())).after.theme.navStyle).toBe('label');
  });

  it('B11 font', async () => {
    expect((await change('字体换成系统字体', workspace())).after.theme.font).toBe('system');
    expect((await change('字体改成衬线', workspace())).after.theme.font).toBe('serif');
  });

  it('B12 reset the style', async () => {
    const styled = apply(workspace(), [
      { op: 'setTheme', primaryColor: '#2F9E44', radius: 0, density: 'compact' },
    ]);
    expect((await change('恢复默认样式', styled)).after.theme).toEqual(workspace().theme);
  });
});

describe('mock AI — navigation and pages', () => {
  it('B13 AI, History and Tools can be removed; Settings still has AI and History', async () => {
    const { after } = await change('把 AI 入口删掉', workspace());
    expect(after.shell.nav).toEqual(['page:home', 'tools', 'history', 'settings']);
    expect(after.shell.floating).toEqual([]);
    const noHistory = (await change('把历史从导航栏移除', after)).after;
    expect(noHistory.shell.nav).toEqual(['page:home', 'tools', 'settings']);
    expect((await change('remove tools', workspace('en'), 'en')).after.shell.nav).toEqual([
      'page:home',
      'ai',
      'history',
      'settings',
    ]);
  });

  it('B14 make an entry a floating button', async () => {
    const { after } = await change('把 AI 做成浮动按钮', workspace());
    expect(after.shell.floating).toEqual(['ai']);
    expect(after.shell.nav).not.toContain('ai');
  });

  it('E1 adds a page with an entry in the nav bar, or on the home page when the bar is full', async () => {
    const trimmed = apply(workspace(), [{ op: 'setNavItems', items: ['page:home', 'settings'] }]);
    const { after } = await change('新建一个叫「记账」的页面', trimmed);
    const page = after.pages.find((p) => p.title === '记账')!;
    expect(page).toMatchObject({ id: 'page-1', components: [{ type: 'header' }] });
    expect(after.shell.nav).toEqual(['page:home', 'page:page-1', 'settings']);

    const full = (await change('Add a page called Budget', workspace('en'), 'en')).after;
    expect(full.shell.nav).toHaveLength(5);
    expect(home(full).components.at(-1)).toMatchObject({
      type: 'shortcut',
      props: { target: 'page:page-1' },
    });
  });

  it('E2 removes a page the user added', async () => {
    const added = (await change('新建一个叫「记账」的页面', workspace())).after;
    const { after } = await change('删除记账页面', added);
    expect(after.pages.map((p) => p.id)).toEqual(['home']);
    expect(home(after).components.some((c) => c.type === 'shortcut')).toBe(false);
    expect(await plan('删除首页页面', workspace())).toMatchObject({ kind: 'reject' });
  });
});

describe('mock AI — data pages (structure only)', () => {
  it.each([
    ['新建一个记账页面', 'zh', '账目'],
    ['新建待办清单', 'zh', '待办'],
    ['做一个读书清单', 'zh', '书单'],
    ['新建笔记页面', 'zh', '笔记'],
    ['Create a to-do list', 'en', 'To-dos'],
  ] as const)('F1 “%s” builds a data table and page', async (input, locale, table) => {
    const { after } = await change(input, workspace(locale), locale);
    expect(after.collections.map((c) => c.name)).toEqual([table]);
    expect(after.pages).toHaveLength(2);
  });

  it('F2 adds a field to a table', async () => {
    const budget = (await change('新建一个记账页面', workspace())).after;
    const { after, lines } = await change('给账目加一个「支付方式」字段', budget);
    expect(after.collections[0]!.fields.at(-1)).toEqual({
      id: 'field-1',
      name: '支付方式',
      type: 'text',
    });
    expect(lines).toEqual(['给「账目」加字段「支付方式」（文字）']);
  });

  it.each([
    '记一笔午饭 35',
    '把上个月的账都删掉',
    '把待办都标成完成',
    '我这个月花了多少',
    'delete all my expenses',
  ])('X4 “%s” touches recorded data and is refused', async (input) => {
    const budget = (await change('新建一个记账页面', workspace())).after;
    expect(await plan(input, budget, /[a-z]/.test(input) ? 'en' : 'zh')).toMatchObject({
      kind: 'reject',
      reason: 'userData',
    });
  });
});

describe('mock AI — images and icons', () => {
  it('G1 adds an empty image slot; the user picks the photo later', async () => {
    const { after, lines } = await change('在首页顶部加一张横幅', workspace());
    expect(home(after).components[1]).toEqual({
      id: 'image-1',
      type: 'image',
      props: { aspect: 'wide', fit: 'cover', placeholder: '点按选择一张照片' },
    });
    expect(lines).toEqual(['在「首页」添加图片']);
    const en = await change('Add a photo to the home page', workspace('en'), 'en');
    expect(home(en.after).components.at(-1)).toMatchObject({
      type: 'image',
      props: { aspect: 'landscape' },
    });
  });

  it('G2 sets an emoji as a page icon', async () => {
    const budget = (await change('新建一个记账页面', workspace())).after;
    const { after } = await change('把记账页面的图标换成💰', budget);
    expect(after.pages.find((p) => p.title === '记账')!.icon).toBe('💰');
    expect(await plan('把记账页面的图标换成钱', budget)).toMatchObject({ kind: 'reject' });
  });
});

describe('mock AI — journey C (PDF tool)', () => {
  it('C1 simplifies to pick + merge, saves automatically as 合并-日期', async () => {
    const { after, lines } = await change(
      '把 PDF 工具首页简化成上传和合并两个步骤，完成后自动按照‘合并-日期’命名',
      workspace('zh', { withPdf: true }),
    );
    expect(mergeSteps(after).map((s) => s.action)).toEqual([
      'pdf.selectFiles',
      'pdf.merge',
      'file.save',
    ]);
    expect(mergeSteps(after)[2]!.params).toEqual({ nameTemplate: '合并-{date:YYYY-MM-DD}' });
    expect(
      after.pages.find((p) => p.id === 'tool-pdf')!.components.find((c) => c.type === 'text')!
        .hidden,
    ).toBe(true);
    // 仍然是同一个工具实例。
    expect(after.tools).toHaveLength(1);
    expect(after.workflows).toHaveLength(1);
    expect(lines.some((l) => l.includes('合并-2026-10-22.pdf'))).toBe(true);
  });

  it('C2 “合并后的文件按日期命名” changes the naming only', async () => {
    const { after } = await change('合并后的文件按日期命名', workspace('zh', { withPdf: true }));
    expect(mergeSteps(after).map((s) => s.id)).toEqual(['select', 'merge', 'name', 'save']);
    expect(mergeSteps(after)[3]!.params).toEqual({ nameTemplate: '{date:YYYY-MM-DD}' });
    expect(mergeSteps(after)[2]!.params).toEqual({ defaultTemplate: '{date:YYYY-MM-DD}' });
  });
});

describe('mock AI — journey D (undo / restore)', () => {
  it.each(['恢复上一次修改前的界面', '撤销刚才的修改', 'Undo the last change'])(
    '%s',
    async (input) => {
      expect(await plan(input, workspace())).toEqual({ kind: 'restorePrevious' });
    },
  );

  it('undo mixed with other changes is rejected', async () => {
    expect(await plan('撤销刚才的修改，主题换成绿色', workspace())).toMatchObject({
      kind: 'reject',
    });
  });
});

describe('mock AI — must refuse', () => {
  it('X1 unrelated request: “I don’t understand” with examples, no guessing', async () => {
    const p = await plan('帮我订一张机票', workspace());
    expect(p).toMatchObject({ kind: 'reject', reason: 'unknown' });
    if (p.kind === 'reject') expect(p.examples.length).toBeGreaterThan(0);
  });

  it('X2 removing Settings is refused as protected', async () => {
    expect(await plan('把设置删掉', workspace())).toMatchObject({
      kind: 'reject',
      reason: 'protected',
    });
    expect(await plan('hide settings', workspace('en'), 'en')).toMatchObject({
      kind: 'reject',
      reason: 'protected',
    });
  });

  it('X3 deleting files is refused', async () => {
    expect(await plan('删除我所有的 PDF 文件', workspace('zh', { withPdf: true }))).toMatchObject({
      kind: 'reject',
      reason: 'deleteFiles',
    });
  });

  it('one unknown clause rejects the whole sentence', async () => {
    expect(await plan('主题换成绿色，顺便帮我写首诗', workspace())).toMatchObject({
      kind: 'reject',
      reason: 'unknown',
    });
  });

  it('words that merely contain “ai” are not treated as the AI entry', async () => {
    expect(await plan('remove the email', workspace('en'), 'en')).toMatchObject({
      reason: 'unknown',
    });
  });
});
