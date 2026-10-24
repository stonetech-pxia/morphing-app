import { createDefaultWorkspace } from '../defaults';
import { applyOps, type Op } from '../ops';
import type { Registry } from '../registry';
import { allComponents, type Locale, type WorkspaceConfig } from '../schema';
import { parseRichText } from '../richtext';
import { templateOps } from '../templates';
import { THEME_PRESETS } from '../presets';
import { CLAY, contrast, isDark, resolveColors } from '../theme';
import { presetById, presetWorkflow } from '../workflows/presets';
import type { Plan, PlanAbout, RejectReason } from './types';

/** 结构相同即可（校验后对象的键顺序可能变）。 */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

// AI 评测集（§7F、§14）：mock AI 与真实模型用同一组用例衡量。
// ID 与 docs/MOCK_AI_PHRASES.md 对应；P* 是只有真实模型才需要理解的改写说法。

export type EvalSetup = 'default' | 'pdf' | 'pdfBelowFiles' | 'budget' | 'visa';

export type OpsPlan = Extract<Plan, { kind: 'ops' }>;

export type EvalExpectation =
  | {
      kind: 'ops';
      check: (after: WorkspaceConfig) => string | null;
      /** 检查计划本身（notes、homeEntry）。 */
      plan?: (plan: OpsPlan) => string | null;
    }
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
  /** 从哪里打开的 AI（D-124）：一个快捷操作，或分享进来的文件。 */
  about?: PlanAbout;
}

export function buildSetup(setup: EvalSetup, locale: Locale, registry: Registry): WorkspaceConfig {
  const ops: Op[] = [];
  if (setup === 'visa') {
    ops.push({ op: 'installTool', toolId: 'pdf' });
    ops.push({
      op: 'addWorkflow',
      workflow: presetWorkflow(presetById('visa-photo')!, locale, 'visa-photo'),
    });
  } else if (setup === 'budget') {
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
/** PDF 工具页上「合并 PDF」的卡片排在标题后面的第一个。 */
const mergeRunnerFirst = (c: WorkspaceConfig) => {
  const page = c.pages.find((p) => p.id === 'tool-pdf');
  const first = page?.components.find((x) => x.type !== 'header');
  return first?.id === 'pdf-runner';
};
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
const renameStep = (c: WorkspaceConfig) => mergeSteps(c).find((s) => s.action === 'file.rename');
const savesWithDate = (c: WorkspaceConfig) => {
  const template = String(renameStep(c)?.params.template);
  return /\{date(:YYYY-MM-DD)?\}/.test(template)
    ? null
    : `the file.rename template should contain the date, got ${template}`;
};
const singlePdfTool = (c: WorkspaceConfig) =>
  c.tools.length === 1 &&
  c.workflows.filter((w) => w.id === 'pdf-merge').length === 1 &&
  new Set(c.workflows.map((w) => w.id)).size === c.workflows.length
    ? null
    : 'must keep exactly one PDF tool and one merge workflow';
/** 用户看得到的步骤只剩选文件和合并：命名、保存可以保留，但不再询问。 */
const simplifiedMerge = (c: WorkspaceConfig) => {
  const steps = mergeSteps(c);
  const visible = steps.filter((s) => s.action !== 'file.rename' && s.action !== 'file.save');
  const actions = visible.map((s) => s.action);
  if (JSON.stringify(actions) !== JSON.stringify(['in.files', 'pdf.merge'])) {
    return `visible steps should be in.files/pdf.merge, got ${actions.join(',')}`;
  }
  if (!steps.some((s) => s.action === 'file.save')) return 'file.save must stay';
  return steps.some((s) => s.ask?.length) ? 'no step should ask the user any more' : null;
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
const savesAs = (template: string) => (c: WorkspaceConfig) =>
  renameStep(c)?.params.template === template
    ? null
    : `the file.rename template should be ${template}, got ${String(renameStep(c)?.params.template)}`;

const BASE_EVAL_CASES: readonly EvalCase[] = [
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
    id: 'B12b',
    input: '换成杂志风',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        sameValue(c.theme, THEME_PRESETS.editorial.theme)
          ? null
          : `theme should be the editorial preset, got ${JSON.stringify(c.theme)}`,
    },
  },
  {
    id: 'B12d',
    input: '换成毛玻璃风格',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        sameValue(c.theme, THEME_PRESETS.glass.theme)
          ? null
          : `theme should be the glass preset, got ${JSON.stringify(c.theme)}`,
    },
  },
  {
    id: 'B12c',
    input: '换成霓虹风格，主色改成粉色',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        if (c.theme.cardStyle !== 'glow')
          return `expected the neon preset, got ${c.theme.cardStyle}`;
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.theme.primaryColor.slice(i, i + 2), 16));
        return r! > 180 && r! > g! + 40 && b! > g!
          ? null
          : `primary should be pink, got ${c.theme.primaryColor}`;
      },
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
    // T3 之后 PDF 工具页上也有「合并 PDF」的卡片：挪首页的 PDF 卡片，或者把工具页上的合并卡片挪到最前，都算理解对了。
    expect: {
      kind: 'ops',
      check: (c) => (pdfFirst(c) === null || mergeRunnerFirst(c) ? null : pdfFirst(c)),
    },
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

// ---- 工作流（T7）----

/** 用户自己的工作流（不属于工具）。 */
const userWorkflows = (c: WorkspaceConfig) => c.workflows.filter((w) => !w.toolId);
const visa = (c: WorkspaceConfig) =>
  c.workflows.find((w) => w.id === 'visa-photo' || w.presetId === 'visa-photo');
/** 有一个用户工作流按顺序包含这些动作（中间可以有别的步骤），参数满足 check。 */
const hasWorkflow =
  (
    actions: readonly string[],
    check: (steps: { action: string; params: Record<string, unknown> }[]) => string | null = () =>
      null,
  ) =>
  (c: WorkspaceConfig) => {
    for (const wf of userWorkflows(c)) {
      let i = 0;
      for (const step of wf.steps) if (step.action === actions[i]) i++;
      if (i === actions.length) return check(wf.steps);
    }
    return `expected a workflow with ${actions.join(' → ')}, got ${userWorkflows(c)
      .map((w) => w.steps.map((s) => s.action).join(' → '))
      .join(' | ')}`;
  };
const param =
  (action: string, key: string, value: unknown) =>
  (steps: { action: string; params: Record<string, unknown> }[]) => {
    const got = steps.find((s) => s.action === action)?.params[key];
    return got === value ? null : `${action}.${key} should be ${String(value)}, got ${String(got)}`;
  };
/** 有一个用户快捷操作翻译成 to；first 给了时第一步必须是其中之一。 */
const translatesTo =
  (to: string, first?: readonly string[]) =>
  (c: WorkspaceConfig): string | null => {
    for (const wf of userWorkflows(c)) {
      const step = wf.steps.find((s) => s.action === 'translate.text');
      if (step?.params.to === to && (!first || first.includes(wf.steps[0]?.action ?? ''))) {
        return null;
      }
    }
    return `expected a quick action translating into ${to}, got ${userWorkflows(c)
      .map((w) =>
        w.steps
          .map(
            (s) => `${s.action}${s.action === 'translate.text' ? `(${String(s.params.to)})` : ''}`,
          )
          .join(' → '),
      )
      .join(' | ')}`;
  };

const visaActions = (c: WorkspaceConfig) => visa(c)?.steps.map((s) => s.action) ?? [];

const WORKFLOW_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'W1',
    input: '添加签证照片工作流',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: hasWorkflow(['in.photos', 'image.idPhoto']) },
  },
  {
    id: 'W2',
    input: '新建一个工作流：选照片，长边 1600，压到 500KB，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'image.resize', 'image.compress', 'out.share'],
        (steps) =>
          param('image.compress', 'maxKB', 500)(steps) ?? param('image.resize', 'px', 1600)(steps),
      ),
    },
  },
  {
    id: 'W2-en',
    input: 'Create a workflow: choose photos, convert to JPG, remove location, zip, share',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow([
        'in.photos',
        'image.convert',
        'image.stripMetadata',
        'zip.create',
        'out.share',
      ]),
    },
  },
  {
    id: 'W3',
    input: '把签证照片改名为美签照片',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => (visa(c)?.name === '美签照片' ? null : `name is ${visa(c)?.name}`),
    },
  },
  {
    id: 'W4',
    input: '删除签证照片工作流',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: { kind: 'ops', check: (c) => (visa(c) ? 'the visa workflow is still there' : null) },
  },
  {
    id: 'W4-tool',
    input: '删除合并 PDF 工作流',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'reject' },
  },
  {
    id: 'W5',
    input: '把签证照片放到首页',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        allComponents(home(c)).some(
          (x) => x.type === 'workflowRunner' && x.props.workflowId === visa(c)?.id,
        )
          ? null
          : 'no runner for the visa workflow on the home page',
    },
  },
  {
    id: 'W6',
    input: '在签证照片里加一步去掉定位',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        visaActions(c).includes('image.stripMetadata')
          ? null
          : `steps are ${visaActions(c).join(',')}`,
    },
  },
  {
    id: 'W7',
    input: '把签证照片的大小改成 200KB',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => {
        const got = visa(c)?.steps.find((s) => s.action === 'image.idPhoto')?.params.maxKB;
        return got === 200 ? null : `maxKB is ${String(got)}`;
      },
    },
  },
  {
    id: 'W8',
    input: '把签证照片的命名这一步去掉',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        visaActions(c).includes('file.rename') ? 'the naming step is still there' : null,
    },
  },
  {
    id: 'W9',
    input: '把本月的账目做成 PDF 报表',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.records', 'print.records'], (steps) =>
        param('in.records', 'period', 'thisMonth')(steps),
      ),
    },
  },
  {
    id: 'W10',
    input: '新建一个工作流：扫描文档，压到 300KB，存到文件',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'image.compress', 'file.save'],
        (steps) =>
          param('in.photos', 'source', 'scanner')(steps) ??
          param('image.compress', 'maxKB', 300)(steps),
      ),
    },
  },
  {
    id: 'W10-en',
    input: 'Create a workflow: scan documents, make a PDF, share',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'pdf.fromImages', 'out.share'], (steps) =>
        param('in.photos', 'source', 'scanner')(steps),
      ),
    },
  },
  {
    id: 'W11',
    input: '新建工作流：选照片，压到 500KB，存到 iCloud 的某个文件夹',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'image.compress', 'out.saveToFolder'], (steps) =>
        param('image.compress', 'maxKB', 500)(steps),
      ),
    },
  },
  {
    id: 'W11-en',
    input: 'Create a workflow: choose photos, compress to 500 KB, save to a folder',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'image.compress', 'out.saveToFolder']),
    },
  },
  {
    id: 'PW1',
    input: '帮我做个流程：拍收据，拉正，压缩到 300K，然后存起来',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'scan.detect', 'image.compress', 'file.save'], (steps) =>
        param('image.compress', 'maxKB', 300)(steps),
      ),
    },
  },
  {
    id: 'PW2',
    input: 'I want the visa photo workflow to also open the share sheet at the end',
    locale: 'en',
    setup: 'visa',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        visaActions(c).at(-1) === 'out.share' ? null : `steps are ${visaActions(c).join(',')}`,
    },
  },
  {
    id: 'PW3',
    input: 'Make a monthly PDF of my expenses with the total at the bottom',
    locale: 'en',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.records', 'print.records'],
        (steps) =>
          param('in.records', 'period', 'thisMonth')(steps) ??
          param('print.records', 'template', 'receipt')(steps),
      ),
    },
  },
  {
    id: 'PW4',
    input: '我想把扫描文档这个预设加进来，再把它放在首页上',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const wf = userWorkflows(c).find((w) => w.steps.some((s) => s.action === 'scan.detect'));
        if (!wf) return 'no scanning workflow';
        return allComponents(home(c)).some(
          (x) => x.type === 'workflowRunner' && x.props.workflowId === wf.id,
        )
          ? null
          : 'the scanning workflow is not on the home page';
      },
    },
  },
  {
    id: 'PW5',
    input: '做一个流程：用文档相机扫描几页合同，合成 PDF，然后分享',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'pdf.fromImages', 'out.share'], (steps) =>
        param('in.photos', 'source', 'scanner')(steps),
      ),
    },
  },
  {
    id: 'PW6',
    input: '做个流程：扫描合同，合成 PDF，直接存进我 Google Drive 里的一个文件夹',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'pdf.fromImages', 'out.saveToFolder']),
    },
  },
  {
    id: 'PW7',
    input:
      'Make a workflow that shrinks my photos to 1 MB each and sends them all to WhatsApp in one go',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'image.compress', 'out.share'], (steps) =>
        param('image.compress', 'maxKB', 1024)(steps),
      ),
    },
  },
];

// 「目标式」说法（D-110）：用户只说「我有什么、想要什么」，AI 自己搭工作流。只要求真实模型通过。
// 同时检查：不顺手放到首页（D-109）、做不到的部分写进 notes、按用途补步骤但不加多余的。

/** 没有任何页面上的运行卡片（用户没说要放首页）。 */
const noRunner = (c: WorkspaceConfig) => {
  const runners = c.pages.flatMap((p) =>
    allComponents(p).filter((x) => x.type === 'workflowRunner'),
  );
  return runners.length === 0 ? null : `added a runner on a page without being asked`;
};
const withoutAction = (action: string) => (c: WorkspaceConfig) =>
  userWorkflows(c).some((w) => w.steps.some((s) => s.action === action))
    ? `added a ${action} step the goal does not need`
    : null;
const someAction =
  (actions: readonly string[]) => (steps: { action: string; params: Record<string, unknown> }[]) =>
    steps.some((s) => actions.includes(s.action))
      ? null
      : `expected one of ${actions.join(' / ')}, got ${steps.map((s) => s.action).join(',')}`;
const datedName = (steps: { action: string; params: Record<string, unknown> }[]) => {
  const template = steps.find((s) => s.action === 'file.rename')?.params.template;
  return typeof template === 'string' && /\{date/.test(template)
    ? null
    : `the file name should carry the date, got ${String(template)}`;
};
const hasNotes = (plan: OpsPlan) =>
  plan.notes && plan.notes.length > 0 ? null : 'expected notes on what the app cannot do';

const GOAL_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'GW1',
    input: '身份证正反面两张照片，学校要一个 PDF，不能超过 2MB',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        hasWorkflow(['in.photos', 'pdf.fromImages'], param('pdf.fromImages', 'maxMB', 2)),
        noRunner,
      ),
    },
  },
  {
    id: 'GW2',
    input: '纸质合同要签字后发回',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        hasWorkflow(
          ['in.photos', 'pdf.fromImages', 'pdf.sign', 'out.share'],
          param('in.photos', 'source', 'scanner'),
        ),
        noRunner,
      ),
    },
  },
  {
    id: 'GW3',
    input: '要申请美国签证，我有一张自拍',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        (c) => (visa(c) ? null : 'expected the visa photo preset'),
        hasWorkflow(['in.photos', 'image.idPhoto'], param('image.idPhoto', 'spec', 'us-passport')),
        noRunner,
      ),
    },
  },
  {
    id: 'GW4',
    input: '每个月要把发票拍下来整理成一个 PDF 发给会计',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      // 没有定时运行：要在 notes 里说「每月需要你自己点一次」；发给会计按日期命名。
      check: all(hasWorkflow(['in.photos', 'pdf.fromImages'], datedName), noRunner),
      plan: hasNotes,
    },
  },
  {
    id: 'GW5',
    input: '几张照片要发邮件给朋友',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      // 多张大照片可能超过邮件附件上限：要压缩或缩小。
      check: all(
        hasWorkflow(['in.photos', 'out.share'], someAction(['image.compress', 'image.resize'])),
        noRunner,
      ),
    },
  },
  {
    id: 'GW6',
    input: '把购物小票拍下来存成 PDF',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      // 拉正就够了，不用再让用户手动裁剪。
      check: all(
        hasWorkflow(['in.photos', 'pdf.fromImages']),
        withoutAction('image.crop'),
        noRunner,
      ),
    },
  },
  {
    id: 'GW7',
    input: '添加扫描文档工作流，但是不要放到首页',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.photos', 'scan.detect']), noRunner),
      plan: (plan) => (plan.homeEntry === false ? null : 'homeEntry should be false'),
    },
  },
  {
    id: 'GW4-en',
    input: 'Every month I photograph my invoices and send one PDF to my accountant',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.photos', 'pdf.fromImages'], datedName), noRunner),
      plan: hasNotes,
    },
  },
];

// 新说法（D-112）：「快捷操作 / quick action」「添加 / 移除工具」「改动记录」，旧说法仍然能用（W*、P7）。

const toolIds = (c: WorkspaceConfig) => c.tools.map((t) => t.toolId);
const onHome = (c: WorkspaceConfig) =>
  allComponents(home(c)).some(
    (x) => x.type === 'workflowRunner' && x.props.workflowId === visa(c)?.id,
  )
    ? null
    : 'no runner for the visa quick action on the home page';

const WORDING_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'QA1',
    input: '添加签证照片快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: hasWorkflow(['in.photos', 'image.idPhoto']) },
  },
  {
    id: 'QA1-en',
    input: 'Add the visa photo quick action',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: hasWorkflow(['in.photos', 'image.idPhoto']) },
  },
  {
    id: 'QA2',
    input: '新建一个快捷操作：选照片，压到 500KB，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'image.compress', 'out.share'],
        param('image.compress', 'maxKB', 500),
      ),
    },
  },
  {
    id: 'QA3',
    input: '把签证照片快捷操作放到首页',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: { kind: 'ops', check: onHome },
  },
  {
    id: 'QA4',
    input: '把改动记录从导航栏去掉',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.shell.nav.includes('history')
          ? `History should leave the bar, got ${c.shell.nav.join(',')}`
          : null,
    },
  },
  {
    id: 'QA5',
    input: '添加图片工具',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        toolIds(c).includes('image') ? null : `image tool not added: ${toolIds(c).join(',')}`,
    },
  },
  {
    id: 'QA6',
    input: 'Remove the PDF tool',
    locale: 'en',
    setup: 'pdf',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => (toolIds(c).includes('pdf') ? 'the PDF tool is still there' : null),
    },
  },
];

// AI 只改 App（D-113、D-124）：办事类请求拒绝并给出能做的快捷操作；文件上的事照样做成快捷操作；
// 从一个快捷操作打开时「这个」指它；从收件页面打开时，新快捷操作的第一步收得下分享的文件。

const visaStep = (c: WorkspaceConfig, action: string) =>
  visa(c)?.steps.find((s) => s.action === action);
/** visa 场景里用户自己的快捷操作只有签证照片：改它，不新建。 */
const onlyVisa = (c: WorkspaceConfig) =>
  userWorkflows(c).length === 1 ? null : `made a new quick action instead of changing this one`;
const homeEntryOff = (plan: OpsPlan) =>
  plan.homeEntry === false ? null : 'a quick action for shared files should set homeEntry: false';
const photosFit =
  (count: number) => (steps: { action: string; params: Record<string, unknown> }[]) => {
    const first = steps[0];
    if (first?.action !== 'in.photos')
      return `first step should be in.photos, got ${first?.action}`;
    const { min, max } = first.params as { min: number; max: number };
    return min <= count && count <= max ? null : `in.photos ${min}..${max} does not take ${count}`;
  };

const ABOUT_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'ER1',
    input: '帮我写一封请假邮件',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    // D-171：翻译文件是文件上的事，做一个翻译快捷操作（以前按办事拒绝）。
    id: 'ER2',
    input: '把这份合同翻译成英文',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'ops', check: translatesTo('en', ['in.files', 'in.photos']) },
  },
  {
    id: 'ER3',
    input: 'What does this contract say?',
    locale: 'en',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'ER4',
    input: '现在帮我运行签证照片',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'ER5',
    input: '这几张照片太大了，帮我压到 200KB',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'image.compress'], param('image.compress', 'maxKB', 200)),
    },
  },
  {
    id: 'AB1',
    input: '把这个的大小改成 200KB',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    about: { kind: 'workflow', workflowId: 'visa-photo' },
    expect: {
      kind: 'ops',
      check: all(onlyVisa, (c) =>
        visaStep(c, 'image.idPhoto')?.params.maxKB === 200
          ? null
          : 'the visa photo should be at most 200 KB',
      ),
    },
  },
  {
    id: 'AB2',
    input: '再小一点，150KB 以内',
    locale: 'zh',
    setup: 'visa',
    mock: false,
    about: { kind: 'workflow', workflowId: 'visa-photo' },
    expect: {
      kind: 'ops',
      check: all(onlyVisa, (c) =>
        visaStep(c, 'image.idPhoto')?.params.maxKB === 150
          ? null
          : `the visa photo should be at most 150 KB, got ${String(visaStep(c, 'image.idPhoto')?.params.maxKB)}`,
      ),
    },
  },
  {
    id: 'AB3-en',
    input: 'Also take the location out of it',
    locale: 'en',
    setup: 'visa',
    mock: false,
    about: { kind: 'workflow', workflowId: 'visa-photo' },
    expect: {
      kind: 'ops',
      check: all(onlyVisa, (c) =>
        visaStep(c, 'image.stripMetadata') ? null : 'no location removal step in the visa photo',
      ),
    },
  },
  {
    id: 'SH1',
    input: '做成一个 PDF',
    locale: 'zh',
    setup: 'default',
    mock: false,
    about: { kind: 'shared', images: 2, pdfs: 0, others: 0 },
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.photos', 'pdf.fromImages'], photosFit(2)), noRunner),
      plan: homeEntryOff,
    },
  },
  {
    id: 'SH2-en',
    input: 'Combine them into one file',
    locale: 'en',
    setup: 'default',
    mock: false,
    about: { kind: 'shared', images: 0, pdfs: 3, others: 0 },
    expect: {
      kind: 'ops',
      check: all(
        hasWorkflow(['in.files', 'pdf.merge'], (steps) => {
          const { accept, max } = steps[0]!.params as { accept: string; max: number };
          return ['pdf', 'pdfOrImages', 'any'].includes(accept) && max >= 3
            ? null
            : `in.files ${accept} max ${max} does not take 3 PDFs`;
        }),
        noRunner,
      ),
      plan: homeEntryOff,
    },
  },
];

/** 视频和压缩 PDF（D-140–D-147）。V* 是 mock 句式（MOCK_AI_PHRASES W12–W14），PV* 和 SH3 只要求真实模型。 */
const firstVideo = (steps: { action: string; params: Record<string, unknown> }[]) => {
  const first = steps[0];
  if (first?.action === 'in.videos') return null;
  if (first?.action === 'in.files' && first.params.accept === 'videos') return null;
  return `first step should pick videos, got ${first?.action}`;
};
const firstPdf = (steps: { action: string; params: Record<string, unknown> }[]) => {
  const first = steps[0];
  return first?.action === 'in.files' &&
    ['pdf', 'pdfOrImages', 'any'].includes(String(first.params.accept))
    ? null
    : `first step should pick PDFs, got ${first?.action} ${String(first?.params.accept)}`;
};
const presetAdded = (id: string) => (c: WorkspaceConfig) =>
  userWorkflows(c).some((w) => w.presetId === id) ? null : `the ${id} preset was not added`;

const VIDEO_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'V1',
    input: '新建一个快捷操作：选视频，压到 20MB，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.videos', 'video.compress', 'out.share'],
        (steps) =>
          param('video.compress', 'maxMB', 20)(steps) ??
          param('video.compress', 'by', 'size')(steps),
      ),
    },
  },
  {
    id: 'V1-en',
    input: 'Create a quick action: choose videos, compress to 25 MB, then share',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.videos', 'video.compress', 'out.share'],
        param('video.compress', 'maxMB', 25),
      ),
    },
  },
  {
    id: 'V2',
    input: '新建一个快捷操作：选视频，转成 MP4',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: hasWorkflow(['in.videos', 'video.convert']) },
  },
  {
    id: 'V3',
    input: '新建一个快捷操作：选视频，剪一段，压缩视频，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.videos', 'video.trim', 'video.compress', 'out.share']),
    },
  },
  {
    id: 'V4',
    input: '新建一个快捷操作：选 PDF，压到 2MB，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.files', 'pdf.compress', 'out.share'],
        param('pdf.compress', 'maxMB', 2),
      ),
    },
  },
  {
    id: 'V4-en',
    input: 'Create a quick action: choose PDFs, compress to 1 MB',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.files', 'pdf.compress'], param('pdf.compress', 'maxMB', 1)),
    },
  },
  {
    id: 'V5',
    input: '添加视频太大发不出去快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: presetAdded('video-too-big') },
  },
  {
    id: 'V6-en',
    input: 'Add the PDF too big to upload quick action',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: presetAdded('pdf-too-big') },
  },
  {
    id: 'PV1',
    input: '视频太大了微信发不出去，帮我做个能压到 25MB 再分享的',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['video.compress', 'out.share'],
        (steps) => firstVideo(steps) ?? param('video.compress', 'maxMB', 25)(steps),
      ),
    },
  },
  {
    id: 'PV2',
    input: '朋友说我发的 MOV 视频在电脑上打不开，做一个转换的快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['video.convert'], firstVideo) },
  },
  {
    id: 'PV3-en',
    input: 'The school portal only takes PDFs under 2 MB and my scanned transcript is 15 MB',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        hasWorkflow(
          ['pdf.compress'],
          (steps) => firstPdf(steps) ?? param('pdf.compress', 'maxMB', 2)(steps),
        ),
        withoutAction('pdf.toImages'),
      ),
    },
  },
  {
    id: 'PV4-en',
    input: 'I want to cut a short part out of a long video and send just that part',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['video.trim', 'out.share'], firstVideo) },
  },
  {
    id: 'PV5',
    input: '把这个视频压到 20MB',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['video.compress'],
        (steps) => firstVideo(steps) ?? param('video.compress', 'maxMB', 20)(steps),
      ),
    },
  },
  {
    id: 'SH3',
    input: '压小一点，好发微信',
    locale: 'zh',
    setup: 'default',
    mock: false,
    about: { kind: 'shared', images: 0, pdfs: 0, others: 0, videos: 1 },
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['video.compress'], firstVideo), noRunner),
      plan: homeEntryOff,
    },
  },
];

// ---- 翻译（D-170–D-176）：翻译文件做成快捷操作；直接要译文仍按办事拒绝 ----

const TRANSLATE_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'TR1',
    input: '帮我翻译一下这句话：Thank you for your help',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'TR2-en',
    input: 'Translate this sentence into Chinese: break a leg',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'TR3',
    input: '新建一个快捷操作：选截图，识别文字，翻译成中文，复制文字',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'ocr.recognize', 'translate.text', 'text.copy'],
        param('translate.text', 'to', 'zh-Hans'),
      ),
    },
  },
  {
    id: 'TR4-en',
    input: 'Translate this letter into Chinese',
    locale: 'en',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'ops', check: translatesTo('zh-Hans', ['in.files', 'in.photos']) },
  },
  {
    id: 'TR5',
    input: '添加截图翻译快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.presetId === 'screenshot-translate')
          ? null
          : 'expected the screenshot-translate preset',
    },
  },
  {
    id: 'TR6',
    input: '收到的日文邮件截图老是看不懂，想以后能一键翻成中文',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        translatesTo('zh-Hans', ['in.photos']),
        hasWorkflow(['in.photos', 'ocr.recognize', 'translate.text']),
      ),
    },
  },
  {
    id: 'TR7',
    input: '翻译成中文',
    locale: 'zh',
    setup: 'default',
    mock: false,
    about: { kind: 'shared', images: 0, pdfs: 1, others: 0 },
    expect: {
      kind: 'ops',
      check: all(
        translatesTo('zh-Hans', ['in.files']),
        hasWorkflow(['in.files', 'pdf.extractText', 'translate.text']),
      ),
    },
  },
  {
    id: 'TR8',
    input: '这句英文是什么意思：It’s raining cats and dogs',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'TR9-en',
    input:
      'I keep getting PDFs in Spanish from my landlord. Make something to read them in English.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        translatesTo('en', ['in.files']),
        hasWorkflow(['in.files', 'pdf.extractText', 'translate.text']),
      ),
    },
  },
];

// ---- 音频（D-150–D-157）：录音转文字、压小、剪一段、合成、取视频的声音做成快捷操作；总结录音内容按办事拒绝 ----
// AU* 是 mock 句式（MOCK_AI_PHRASES AU），PAU* 和 SH4 只要求真实模型。

const firstAudio = (steps: { action: string; params: Record<string, unknown> }[]) => {
  const first = steps[0];
  if (first?.action === 'in.audio') return null;
  if (first?.action === 'in.files' && first.params.accept === 'audio') return null;
  return `first step should pick or record audio, got ${first?.action}`;
};

const AUDIO_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'AU1',
    input: '新建一个快捷操作：录音，转成文字，转成 PDF，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.audio', 'audio.transcribe', 'text.toPdf', 'out.share'],
        (steps) =>
          param('in.audio', 'source', 'record')(steps) ??
          param('audio.transcribe', 'lang', 'zh')(steps),
      ),
    },
  },
  {
    id: 'AU1-en',
    input: 'Create a quick action: choose recordings, transcribe, save as a text file',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.audio', 'audio.transcribe', 'text.toFile'],
        (steps) =>
          param('in.audio', 'source', 'files')(steps) ??
          param('audio.transcribe', 'lang', 'en')(steps),
      ),
    },
  },
  {
    id: 'AU2',
    input: '新建一个快捷操作：选录音，压到 2MB，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.audio', 'audio.compress', 'out.share'],
        (steps) =>
          param('audio.compress', 'maxMB', 2)(steps) ??
          param('audio.compress', 'by', 'size')(steps),
      ),
    },
  },
  {
    id: 'AU3',
    input: '新建一个快捷操作：选几段录音，排序，合成一段，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.audio', 'file.order', 'audio.merge', 'out.share']),
    },
  },
  {
    id: 'AU4',
    input: '新建一个快捷操作：选视频，提取声音，存到文件夹',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.videos', 'audio.fromVideo', 'out.saveToFolder']),
    },
  },
  {
    id: 'AU5',
    input: '新建一个快捷操作：选音频，剪一段，存到文件夹',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.audio', 'audio.trim', 'out.saveToFolder']),
    },
  },
  {
    id: 'AU6',
    input: '添加录音转文字快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: presetAdded('audio-to-text') },
  },
  {
    id: 'AU7-en',
    input: 'Add the recording too big to send quick action',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: presetAdded('audio-too-big') },
  },
  {
    id: 'PAU1',
    input: '上课录的音想变成文字笔记，帮我做一个快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['audio.transcribe'], firstAudio) },
  },
  {
    id: 'PAU2-en',
    input: 'My voice memo is too big to email, it has to be under 10 MB',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['audio.compress'],
        (steps) => firstAudio(steps) ?? param('audio.compress', 'maxMB', 10)(steps),
      ),
    },
  },
  {
    id: 'PAU3',
    input: '采访录了好几段，想拼成一个文件发给编辑',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['audio.merge'], firstAudio) },
  },
  {
    id: 'PAU4',
    input: '想把视频里的背景音乐单独存下来',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['in.videos', 'audio.fromVideo'], firstVideo) },
  },
  {
    id: 'PAU5',
    input: '帮我总结一下这段会议录音说了什么',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'PAU6-en',
    input: 'I want to cut 30 seconds out of a song to use as my ringtone',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['audio.trim'], firstAudio) },
  },
  {
    id: 'SH4',
    input: '转成文字',
    locale: 'zh',
    setup: 'default',
    mock: false,
    about: { kind: 'shared', images: 0, pdfs: 0, others: 0, audio: 1 },
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['audio.transcribe'], firstAudio), noRunner),
      plan: homeEntryOff,
    },
  },
];

export const EVAL_CASES: readonly EvalCase[] = [
  ...BASE_EVAL_CASES,
  ...WORKFLOW_EVAL_CASES,
  ...GOAL_EVAL_CASES,
  ...WORDING_EVAL_CASES,
  ...ABOUT_EVAL_CASES,
  ...VIDEO_EVAL_CASES,
  ...TRANSLATE_EVAL_CASES,
  ...AUDIO_EVAL_CASES,
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
  const problem = c.expect.check(prepared.after) ?? c.expect.plan?.(plan) ?? null;
  return problem ? fail(problem) : { pass: true };
}
