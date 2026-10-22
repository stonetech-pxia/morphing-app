import { createDefaultWorkspace } from '../defaults';
import { applyOps, type Op } from '../ops';
import type { Registry } from '../registry';
import { allComponents, type Locale, type WorkspaceConfig } from '../schema';
import { parseRichText } from '../richtext';
import { templateOps } from '../templates';
import { CLAY, contrast, isDark, resolveColors } from '../theme';
import type { Plan, RejectReason } from './types';

// AI 评测集（§7F、§14）：mock AI 与真实模型用同一组用例衡量。
// ID 与 docs/MOCK_AI_PHRASES.md 对应；P* 是只有真实模型才需要理解的改写说法。

export type EvalSetup = 'default' | 'pdf' | 'pdfBelowFiles' | 'budget';

export type EvalExpectation =
  | { kind: 'ops'; check: (after: WorkspaceConfig) => string | null }
  | { kind: 'restorePrevious' }
  | { kind: 'reject'; reason?: RejectReason };

export interface EvalCase {
  id: string;
  input: string;
  locale: Locale;
  setup: EvalSetup;
  expect: EvalExpectation;
  /** mock AI 是否应当通过（改写说法只要求真实模型通过）。 */
  mock: boolean;
}

export function buildSetup(setup: EvalSetup, locale: Locale, registry: Registry): WorkspaceConfig {
  const ops: Op[] = [];
  if (setup === 'budget') {
    ops.push(...templateOps('budget', createDefaultWorkspace(locale), locale));
  } else if (setup !== 'default') ops.push({ op: 'installTool', toolId: 'pdf' });
  if (setup === 'pdfBelowFiles') {
    ops.push({ op: 'moveComponent', pageId: 'home', componentId: 'card-pdf', toIndex: 3 });
  }
  const base = createDefaultWorkspace(locale);
  if (ops.length === 0) return base;
  const result = applyOps(base, ops, { registry, locale });
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

const home = (c: WorkspaceConfig) => c.pages.find((p) => p.id === 'home')!;
const homeIds = (c: WorkspaceConfig) => home(c).components.map((x) => x.id);
const mergeSteps = (c: WorkspaceConfig) =>
  c.workflows.find((w) => w.id === 'pdf-merge')?.steps ?? [];

/** 每个检查返回 null 表示通过，否则返回失败原因。 */
const all =
  (...checks: ((c: WorkspaceConfig) => string | null)[]) =>
  (c: WorkspaceConfig) =>
    checks.reduce<string | null>((err, check) => err ?? check(c), null);

const pdfFirst = (c: WorkspaceConfig) =>
  homeIds(c)[1] === 'card-pdf'
    ? null
    : `PDF card should be right after the header, got ${homeIds(c).join(',')}`;
const navHomeToolsSettings = (c: WorkspaceConfig) =>
  JSON.stringify(c.shell.nav) === JSON.stringify(['page:home', 'tools', 'settings'])
    ? null
    : `nav should be home/tools/settings, got ${c.shell.nav.join(',')}`;
const titled = (title: string) => (c: WorkspaceConfig) =>
  home(c).title === title ? null : `home title should be ${title}, got ${home(c).title}`;
const color = (hex: string) => (c: WorkspaceConfig) =>
  c.theme.primaryColor.toLowerCase() === hex.toLowerCase()
    ? null
    : `color should be ${hex}, got ${c.theme.primaryColor}`;
/** 文件名包含日期即可（“按日期命名”既可理解为只用日期，也可保留“合并”之类的前缀）。 */
const savesWithDate = (c: WorkspaceConfig) => {
  const save = mergeSteps(c).find((s) => s.action === 'file.save');
  const template = String(save?.params.nameTemplate);
  return template.includes('{date:YYYY-MM-DD}')
    ? null
    : `nameTemplate should contain the date, got ${template}`;
};
const singlePdfTool = (c: WorkspaceConfig) =>
  c.tools.length === 1 && c.workflows.length === 1
    ? null
    : 'must keep exactly one PDF tool and workflow';
const simplifiedMerge = (c: WorkspaceConfig) => {
  const actions = mergeSteps(c).map((s) => s.action);
  return JSON.stringify(actions) === JSON.stringify(['pdf.selectFiles', 'pdf.merge', 'file.save'])
    ? null
    : `steps should be select/merge/save, got ${actions.join(',')}`;
};
/** 首页第 index 个组件是一个还没选照片的图片位（AI 不能替用户选照片）。 */
const imageSlot = (c: WorkspaceConfig, index: number): string | null => {
  const img = home(c).components[index];
  if (img?.type !== 'image') return `expected an image at position ${index}, got ${img?.type}`;
  return img.props.assetId ? 'the AI must not pick a photo' : null;
};
/** 有这个标题的页面，且能从导航栏、浮动按钮或首页的按钮 / 快捷入口打开。 */
const reachablePage = (title: string) => (c: WorkspaceConfig) => {
  const page = c.pages.find((p) => p.title === title);
  if (!page) return `expected a page titled ${title}`;
  const target = `page:${page.id}`;
  const linked =
    [...c.shell.nav, ...c.shell.floating].includes(target as never) ||
    allComponents(home(c)).some(
      (x) => (x.type === 'shortcut' || x.type === 'button') && x.props.target === target,
    );
  return linked ? null : `page ${title} should be reachable`;
};
const darkBackground = (c: WorkspaceConfig) => {
  const colors = resolveColors(c.theme, isDark(c.theme, false));
  return contrast(colors.background, '#000000') < 3
    ? null
    : `background should be dark, got ${colors.background}`;
};
/** 有一张含某类型字段的数据表，并且有一个能打开的页面用上了它（统计求和或可勾选清单）。 */
const dataPage =
  (fieldType: string, usage: 'sum' | 'checklist') =>
  (c: WorkspaceConfig): string | null => {
    const table = c.collections.find((t) => t.fields.some((f) => f.type === fieldType));
    if (!table) return `expected a data table with a ${fieldType} field`;
    const page = c.pages.find((p) =>
      allComponents(p).some((x) =>
        usage === 'sum'
          ? x.type === 'stat' && x.props.collectionId === table.id && x.props.aggregate === 'sum'
          : x.type === 'recordList' &&
            x.props.collectionId === table.id &&
            x.props.display === 'checklist',
      ),
    );
    if (!page) return `expected a page with a ${usage} for ${table.id}`;
    return reachablePage(page.title)(c);
  };
const savesAs = (template: string) => (c: WorkspaceConfig) => {
  const save = mergeSteps(c).find((s) => s.action === 'file.save');
  return save?.params.nameTemplate === template
    ? null
    : `nameTemplate should be ${template}, got ${String(save?.params.nameTemplate)}`;
};

export const EVAL_CASES: readonly EvalCase[] = [
  // 旅程 A
  {
    id: 'A1',
    input: '把首页改成文件工作台，把 PDF 放到最上面，导航栏只保留首页、工具、设置。',
    locale: 'zh',
    setup: 'pdfBelowFiles',
    mock: true,
    expect: { kind: 'ops', check: all(titled('文件工作台'), pdfFirst, navHomeToolsSettings) },
  },
  {
    id: 'A2',
    input: 'PDF 放第一个',
    locale: 'zh',
    setup: 'pdfBelowFiles',
    mock: true,
    expect: { kind: 'ops', check: pdfFirst },
  },
  {
    id: 'A3',
    input: '导航只要首页、工具和设置',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: navHomeToolsSettings },
  },
  {
    id: 'A4',
    input: '首页改成文件工作台',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: titled('文件工作台') },
  },
  {
    id: 'A5',
    input: 'Put PDF at the top',
    locale: 'en',
    setup: 'pdfBelowFiles',
    mock: true,
    expect: { kind: 'ops', check: pdfFirst },
  },
  {
    id: 'A6',
    input: 'Only keep Home, Tools and Settings in the navigation',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: navHomeToolsSettings },
  },
  // 单项修改
  {
    id: 'B1',
    input: '主题换成绿色',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: color('#2F9E44') },
  },
  {
    id: 'B2',
    input: '切换到深色模式',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => (c.theme.mode === 'dark' ? null : `mode should be dark, got ${c.theme.mode}`),
    },
  },
  {
    id: 'B3',
    input: '隐藏欢迎卡片',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => (home(c).components[0]?.hidden ? null : 'welcome header should be hidden'),
    },
  },
  {
    id: 'B4',
    input: '把最近文件放到 PDF 前面',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        homeIds(c).indexOf('recent-files') < homeIds(c).indexOf('card-pdf')
          ? null
          : `recent files should come before PDF, got ${homeIds(c).join(',')}`,
    },
  },
  // 样式
  {
    id: 'B5',
    input: '字体大一点',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.theme.fontScale > 1 ? null : `fontScale should grow, got ${c.theme.fontScale}`,
    },
  },
  {
    id: 'B7',
    input: '卡片圆角小一点',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => (c.theme.radius < 22 ? null : `radius should shrink, got ${c.theme.radius}`),
    },
  },
  {
    id: 'B9',
    input: '去掉阴影',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.theme.cardStyle !== 'shadow'
          ? null
          : `cards should lose their shadow, got ${c.theme.cardStyle}`,
    },
  },
  {
    id: 'B9b',
    input: '卡片改成新粗野风格',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.theme.cardStyle === 'brutal' ? null : `cards should be brutal, got ${c.theme.cardStyle}`,
    },
  },
  {
    id: 'B9d',
    input: '背景改成极光，卡片改成毛玻璃',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.theme.backdrop === 'aurora' && c.theme.cardStyle === 'glass'
          ? null
          : `expected aurora + glass, got ${c.theme.backdrop} + ${c.theme.cardStyle}`,
    },
  },
  {
    id: 'B9c',
    input: '深色模式下用纯黑背景，浅色模式不变',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const light = resolveColors(c.theme, false).background;
        const dark = resolveColors(c.theme, true).background;
        if (light !== CLAY.light.background) return `light background changed to ${light}`;
        return contrast(dark, '#000000') < 1.2
          ? null
          : `dark background should be black, got ${dark}`;
      },
    },
  },
  // 导航与页面
  {
    id: 'B13',
    input: '把 AI 入口删掉',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        !c.shell.nav.includes('ai') && !c.shell.floating.includes('ai')
          ? null
          : `AI should be gone from nav and floating, got ${c.shell.nav.join(',')} / ${c.shell.floating.join(',')}`,
    },
  },
  {
    id: 'E1',
    input: '新建一个叫「记账」的页面',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: reachablePage('记账') },
  },
  // 数据页面（只改结构，从不碰记录）
  {
    id: 'F1',
    input: '新建一个记账页面',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: dataPage('money', 'sum') },
  },
  {
    id: 'F2',
    input: '给账目加一个「支付方式」字段',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.collections[0]?.fields.some((f) => f.name === '支付方式')
          ? null
          : 'expenses should get a 支付方式 field',
    },
  },
  {
    id: 'X4',
    input: '记一笔午饭 35',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: { kind: 'reject', reason: 'userData' },
  },
  {
    id: 'X5',
    input: '把上个月的账都删掉',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: { kind: 'reject', reason: 'userData' },
  },
  // 图片、emoji 图标、富文本
  {
    id: 'G1',
    input: '在首页顶部加一张横幅',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: (c) => imageSlot(c, 1) },
  },
  {
    id: 'G2',
    input: '把记账页面的图标换成💰',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.pages.find((p) => p.id === 'budget')?.icon === '💰'
          ? null
          : 'budget page icon should be 💰',
    },
  },
  // 旅程 C
  {
    id: 'C1',
    input: '把 PDF 工具首页简化成上传和合并两个步骤，完成后自动按照‘合并-日期’命名',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: {
      kind: 'ops',
      check: all(simplifiedMerge, savesAs('合并-{date:YYYY-MM-DD}'), singlePdfTool),
    },
  },
  {
    id: 'C2',
    input: '合并后的文件按日期命名',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'ops', check: all(savesWithDate, singlePdfTool) },
  },
  // 旅程 D
  {
    id: 'D1',
    input: '恢复上一次修改前的界面',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'restorePrevious' },
  },
  {
    id: 'D2',
    input: '撤销刚才的修改',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'restorePrevious' },
  },
  {
    id: 'D3',
    input: 'Undo the last change',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'restorePrevious' },
  },
  // 必须拒绝
  {
    id: 'X1',
    input: '帮我订一张机票',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject' },
  },
  {
    id: 'X2',
    input: '把设置删掉',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject', reason: 'protected' },
  },
  {
    id: 'X3',
    input: '删除我所有的 PDF 文件',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'reject', reason: 'deleteFiles' },
  },
  // 改写说法：只要求真实模型理解
  {
    id: 'P1',
    input: '能不能把合并 PDF 的入口挪到最前面？',
    locale: 'zh',
    setup: 'pdfBelowFiles',
    mock: false,
    expect: { kind: 'ops', check: pdfFirst },
  },
  {
    id: 'P2',
    input: '底部只留三个：首页、工具、设置',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: navHomeToolsSettings },
  },
  {
    id: 'P3',
    input: '我想要一个绿色的界面',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: color('#2F9E44') },
  },
  {
    id: 'P5',
    input: '把首页的工具入口和添加工具排成两列的网格',
    locale: 'zh',
    setup: 'pdf',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const group = home(c).components.find((x) => x.type === 'group');
        if (!group || group.type !== 'group') return 'expected a group on the home page';
        if (group.props.layout !== 'grid')
          return `group layout should be grid, got ${group.props.layout}`;
        const ids = group.children.map((x) => x.id);
        return ids.includes('card-pdf') && ids.includes('catalog')
          ? null
          : `grid should hold card-pdf and catalog, got ${ids.join(',')}`;
      },
    },
  },
  {
    id: 'P6',
    input: '我想要深色背景、白色文字的界面',
    locale: 'zh',
    setup: 'default',
    mock: false,
    // 可读性由校验器保证；这里只检查最终显示的背景确实是深色。
    expect: { kind: 'ops', check: darkBackground },
  },
  {
    id: 'P7',
    input: '把 AI 修改和历史都从底部去掉，设置做成右下角的浮动按钮',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const entries = [...c.shell.nav, ...c.shell.floating];
        if (entries.includes('ai') || entries.includes('history'))
          return `AI and History should be gone, got ${entries.join(',')}`;
        return c.shell.floating.includes('settings') ? null : 'settings should be floating';
      },
    },
  },
  {
    id: 'P8',
    input: 'Add a Notes page with a short intro text, and a shortcut to it on the home page',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const page = c.pages.find((p) => /notes/i.test(p.title));
        if (!page) return 'expected a Notes page';
        if (!page.components.some((x) => x.type === 'text')) return 'Notes page should have text';
        const shortcut = allComponents(home(c)).find(
          (x) =>
            (x.type === 'shortcut' || x.type === 'button') && x.props.target === `page:${page.id}`,
        );
        return shortcut ? null : 'home should link to the Notes page';
      },
    },
  },
  {
    id: 'P9',
    input: '做一个记账页面，能看到这个月一共花了多少',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: dataPage('money', 'sum') },
  },
  {
    id: 'P10',
    input: '我想要一个读书清单，可以勾选读完了没有',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: dataPage('checkbox', 'checklist') },
  },
  {
    id: 'P11',
    input: '账目里加一个支付方式，选项有微信、支付宝、现金',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const f = c.collections[0]?.fields.find(
          (x) => x.type === 'choice' && x.name.includes('支付'),
        );
        if (!f || f.type !== 'choice') return 'expected a choice field for 支付方式';
        return f.options.length === 3 ? null : `expected 3 options, got ${f.options.length}`;
      },
    },
  },
  {
    id: 'P12',
    input: 'How much did I spend this month?',
    locale: 'en',
    setup: 'budget',
    mock: false,
    expect: { kind: 'reject', reason: 'userData' },
  },
  {
    id: 'P13',
    input: '记账页面不要了',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    // 移出界面或删除页面都可以；无论哪种，校验通过即可（记录始终保留在数据库里）。
    expect: {
      kind: 'ops',
      check: (c) =>
        c.pages.some((p) => p.id === 'budget') &&
        [...c.shell.nav, ...c.shell.floating].includes('page:budget')
          ? 'the budget page should be gone or unreachable'
          : null,
    },
  },
  {
    id: 'P14',
    input: '首页标题下面加一段介绍：用粗体强调「全部在本机处理」，再用列表写三个要点',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const t = allComponents(home(c)).find(
          (x) => (x.type === 'text' || x.type === 'notice') && /\*\*[^*]+\*\*/.test(x.props.text),
        );
        if (!t || (t.type !== 'text' && t.type !== 'notice')) return 'expected text with **bold**';
        const blocks = parseRichText(t.props.text);
        const list = blocks.find((b) => b.type === 'list');
        return list && list.type === 'list' && list.items.length >= 3
          ? null
          : 'expected a list with three points';
      },
    },
  },
  {
    id: 'P15',
    input: 'Put a big photo at the top of the home page with the caption “Our family”',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const problem = imageSlot(c, 1);
        if (problem) return problem;
        const img = home(c).components[1]!;
        return img.type === 'image' && img.props.caption === 'Our family'
          ? null
          : 'caption should be “Our family”';
      },
    },
  },
  {
    id: 'P16',
    input: '在首页加一个链接到 https://example.com/help 的帮助说明',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        allComponents(home(c)).some(
          (x) =>
            (x.type === 'text' || x.type === 'notice') &&
            parseRichText(x.props.text).some(
              (b) =>
                b.type === 'paragraph' && b.spans.some((s) => s.url === 'https://example.com/help'),
            ),
        )
          ? null
          : 'expected a text with a link to https://example.com/help',
    },
  },
  {
    id: 'P17',
    input:
      '在首页顶部加一张横幅，标题下面加一段介绍：用粗体强调「全部在本机处理」，再用列表写三个要点，首页图标换成🏡',
    locale: 'zh',
    setup: 'default',
    mock: false,
    // 多项修改一项都不能漏。只说「横幅」时模型可能理解为文字横幅（提示框），所以这里明确说「横幅图片」。
    expect: {
      kind: 'ops',
      check: (c) => {
        if (!home(c).components.some((x) => x.type === 'image' && !x.props.assetId))
          return 'expected an empty image slot on the home page';
        if (home(c).icon !== '🏡') return `home icon should be 🏡, got ${home(c).icon}`;
        const t = allComponents(home(c)).find(
          (x) => (x.type === 'text' || x.type === 'notice') && /\*\*[^*]+\*\*/.test(x.props.text),
        );
        return t ? null : 'expected an intro with **bold**';
      },
    },
  },
  {
    id: 'P4',
    input: 'Make the PDF tool skip asking for a file name and just save it as merged-date',
    locale: 'en',
    setup: 'pdf',
    mock: false,
    expect: { kind: 'ops', check: all(savesAs('merged-{date:YYYY-MM-DD}'), singlePdfTool) },
  },
];

export type EvalOutcome = { pass: true } | { pass: false; reason: string };

/** 判定一个计划是否符合用例预期。afterOrIssues 来自 prepareOps。 */
export function judgeEval(
  c: EvalCase,
  plan: Plan,
  prepared: { ok: true; after: WorkspaceConfig } | { ok: false; issues: string[] } | null,
): EvalOutcome {
  const fail = (reason: string): EvalOutcome => ({ pass: false, reason });
  if (c.expect.kind === 'restorePrevious') {
    return plan.kind === 'restorePrevious'
      ? { pass: true }
      : fail(`expected restorePrevious, got ${plan.kind}`);
  }
  if (c.expect.kind === 'reject') {
    if (plan.kind !== 'reject') return fail(`expected reject, got ${plan.kind}`);
    if (c.expect.reason && plan.reason !== c.expect.reason) {
      return fail(`expected reject reason ${c.expect.reason}, got ${plan.reason}`);
    }
    return { pass: true };
  }
  if (plan.kind !== 'ops')
    return fail(
      `expected ops, got ${plan.kind}${plan.kind === 'reject' ? `: ${plan.message}` : ''}`,
    );
  if (!prepared) return fail('ops were not prepared');
  if (!prepared.ok) return fail(`invalid ops: ${prepared.issues.join('; ')}`);
  const problem = c.expect.check(prepared.after);
  return problem ? fail(problem) : { pass: true };
}
