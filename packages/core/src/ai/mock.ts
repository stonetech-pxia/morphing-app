import { checkNameTemplate } from '../naming';
import { applyOps, topIndex, type Op } from '../ops';
import { THEME_PRESET_IDS, type ThemePresetId } from '../presets';
import type { ToolDefinition } from '../registry';
import {
  HOME_PAGE_ID,
  IdSchema,
  pageTarget,
  type Component,
  type Locale,
  type Localized,
  type NavTarget,
  type Page,
  type WorkspaceConfig,
} from '../schema';
import { isEmoji } from '../richtext';
import { ICON_NAMES } from '../schema';
import { entryOps, templateOps, type DataTemplate } from '../templates';
import type { AIProvider, Plan, PlanContext, RejectReason } from './types';

// 基于规则的 mock AI（§7F）。不是语言模型：只认识 docs/MOCK_AI_PHRASES.md 中的句式。
// 一句话按标点拆成若干子句；任何一个子句无法理解，整句都拒绝，绝不生成猜测性修改。

const EXAMPLES: Localized[] = [
  { zh: '把 PDF 放到最上面', en: 'Put PDF at the top' },
  { zh: '导航只保留首页、工具、设置', en: 'Only keep Home, Tools and Settings in the navigation' },
  { zh: '主题换成绿色', en: 'Change the theme color to green' },
  { zh: '字体大一点', en: 'Bigger text' },
  { zh: '新建一个叫「记账」的页面', en: 'Add a page called Budget' },
  { zh: '撤销刚才的修改', en: 'Undo the last change' },
];

const COLORS: [RegExp, string][] = [
  [/绿|green/i, '#2F9E44'],
  [/蓝|blue/i, '#1C7ED6'],
  [/红|red/i, '#E03131'],
  [/紫|purple/i, '#7048E8'],
  [/橙|orange/i, '#F76707'],
  [/粉|pink/i, '#D6336C'],
  [/灰|黑|gr[ae]y|black/i, '#495057'],
];

class Rejection extends Error {
  constructor(
    readonly reason: RejectReason,
    message: string,
  ) {
    super(message);
  }
}

interface State {
  ctx: PlanContext;
  /** 已应用前面子句后的工作副本。 */
  config: WorkspaceConfig;
  /** 整句话中提到的工具，供“完成后按日期命名”这类省略主语的子句使用。 */
  mentionedTool: ToolDefinition | undefined;
}

const say = (locale: Locale, zh: string, en: string) => (locale === 'zh' ? zh : en);

function splitClauses(input: string): string[] {
  return input
    .replace(/　/g, ' ')
    .replace(/[“”「」『』‘’]/g, '"')
    .split(/[，。；;！!？?\n]|\.\s+/)
    .map((c) =>
      c
        .trim()
        .replace(/^(请|麻烦|帮我|帮忙|能不能|可以|please|can you|could you)\s*/i, '')
        .replace(/(吧|呢|\.)$/, '')
        .trim(),
    )
    .filter((c) => c.length > 0);
}

function findTool(text: string, ctx: PlanContext): ToolDefinition | undefined {
  const lower = text.toLowerCase();
  for (const tool of ctx.registry.tools.values()) {
    const names = [
      ...tool.aliases,
      tool.id,
      tool.name.en.toLowerCase(),
      tool.name.zh.toLowerCase(),
    ];
    if (names.some((n) => lower.includes(n))) return tool;
  }
  return undefined;
}

function requireInstalled(tool: ToolDefinition, state: State): void {
  if (!state.config.tools.some((t) => t.toolId === tool.id)) {
    throw new Rejection(
      'notInstalled',
      say(
        state.ctx.locale,
        `「${tool.name.zh}」工具还没有安装，请先在「工具」里安装。`,
        `The ${tool.name.en} tool isn’t installed yet. Install it from Tools first.`,
      ),
    );
  }
}

function page(state: State, id: string): Page {
  return state.config.pages.find((p) => p.id === id)!;
}

function resolveComponent(rawName: string, target: Page, state: State): Component {
  const name = rawName
    .trim()
    .replace(/^(the|把|将)\s*/i, '')
    .replace(/^(首页|主页)(的|上的|里的)?/, '')
    .replace(/\s*(卡片|入口|模块|区域|card|section)$/i, '')
    .trim();
  const tool = findTool(name, state.ctx);
  const find = (pred: (c: Component) => boolean) => target.components.find(pred);
  let found: Component | undefined;
  if (tool) {
    requireInstalled(tool, state);
    found = find((c) => c.type === 'toolCard' && c.props.toolId === tool.id);
  } else if (/欢迎|标题|welcome|header|title/i.test(name)) {
    found = find((c) => c.type === 'header');
  } else if (/工具目录|添加工具|catalog|add tools/i.test(name)) {
    found = find((c) => c.type === 'catalogLink');
  } else if (/文件|files?|recent/i.test(name)) {
    found = find((c) => c.type === 'fileList');
  } else if (/说明|介绍|intro|description/i.test(name)) {
    found = find((c) => c.type === 'text');
  }
  if (!found) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        `在「${target.title}」上找不到「${name}」。`,
        `Couldn’t find “${name}” on “${target.title}”.`,
      ),
    );
  }
  return found;
}

/** 把 componentId 移到 index 时，以“移出该组件后的列表”为参照。 */
function withoutComponent(p: Page, componentId: string): Page {
  return { ...p, components: p.components.filter((c) => c.id !== componentId) };
}

function findNavItem(rawName: string, state: State): NavTarget | null {
  const name = rawName
    .trim()
    .toLowerCase()
    .replace(/^(the|把|将)\s*/i, '')
    .replace(/\s*(入口|按钮|页面|页|tab|entry|button|page)$/i, '')
    .trim();
  if (/^(首页|主页|home)$/.test(name)) return pageTarget(HOME_PAGE_ID);
  if (/^(工具|工具目录|tools?)$/.test(name)) return 'tools';
  if (/^(设置|settings?)$/.test(name)) return 'settings';
  if (/^(历史|历史记录|历史版本|history)$/.test(name)) return 'history';
  if (/^(ai|ai\s*修改)$/.test(name)) return 'ai';
  const p = state.config.pages.find((x) => x.title.toLowerCase() === name);
  if (p) return pageTarget(p.id);
  return null;
}

function resolveNavItem(rawName: string, state: State): NavTarget {
  const name = rawName.trim().toLowerCase();
  if (/^(首页|主页|home)$/.test(name)) return pageTarget(HOME_PAGE_ID);
  if (/^(工具|工具目录|tools?)$/.test(name)) return 'tools';
  if (/^(设置|settings?)$/.test(name)) return 'settings';
  if (/^(历史|历史记录|history)$/.test(name)) return 'history';
  if (/^(ai|ai\s*修改)$/.test(name)) return 'ai';
  const p = state.config.pages.find((x) => x.title.toLowerCase() === name);
  if (p) return pageTarget(p.id);
  const tool = findTool(name, state.ctx);
  const installed = tool && state.config.tools.find((t) => t.toolId === tool.id);
  if (installed) return pageTarget(installed.pageId);
  throw new Rejection(
    'unknown',
    say(
      state.ctx.locale,
      `导航里没有「${rawName.trim()}」这一项。`,
      `There is no “${rawName.trim()}” to put in the navigation.`,
    ),
  );
}

type Rule = (clause: string, state: State) => Op[] | null;

const navRule: Rule = (clause, state) => {
  const m =
    clause.match(/导航(?:栏)?(?:里|中|上)?(?:只保留|只要|只留|保留|只显示|改成|改为)(.+)$/) ??
    clause.match(/only keep (.+?) in the (?:nav|navigation)(?: bar)?$/i) ??
    clause.match(/(?:nav|navigation)(?: bar)?:? only (.+)$/i);
  if (!m) return null;
  const items = m[1]!
    .split(/、|，|,|和|与|以及|及|\band\b|&/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => resolveNavItem(s, state));
  return [{ op: 'setNavItems', items }];
};

const navStyleRule: Rule = (clause) => {
  const zh = clause.match(
    /导航(?:栏)?(?:里|中|上)?(?:只显示|只要|只留|只保留|改成|改为)(?:显示)?(图标|文字)$/,
  );
  const en =
    clause.match(/^(?:nav|navigation)(?: bar)?:? (icons|labels) only$/i) ??
    clause.match(/^only (?:show )?(icons|labels) in the (?:nav|navigation)(?: bar)?$/i);
  if (zh) return [{ op: 'setTheme', navStyle: zh[1] === '图标' ? 'icon' : 'label' }];
  if (en) return [{ op: 'setTheme', navStyle: /icon/i.test(en[1]!) ? 'icon' : 'label' }];
  if (
    /导航(?:栏)?(?:显示|加上|恢复)图标和文字|(?:icons and labels) in the (?:nav|navigation)/i.test(
      clause,
    )
  ) {
    return [{ op: 'setTheme', navStyle: 'iconLabel' }];
  }
  return null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const fontSizeRule: Rule = (clause, state) => {
  const bigger =
    /^(?:字体|文字|字号|字)(?:再)?大一?(?:点|些)$|^(?:放大|调大)(?:字体|文字|字号)$/.test(clause) ||
    /^(?:make (?:the )?)?(?:text|font)s? (?:bigger|larger)$|^(?:bigger|larger) (?:text|font)s?$/i.test(
      clause,
    );
  const smaller =
    /^(?:字体|文字|字号|字)(?:再)?小一?(?:点|些)$|^(?:缩小|调小)(?:字体|文字|字号)$/.test(clause) ||
    /^(?:make (?:the )?)?(?:text|font)s? smaller$|^smaller (?:text|font)s?$/i.test(clause);
  if (!bigger && !smaller) return null;
  const scale = state.config.theme.fontScale;
  return [
    {
      op: 'setTheme',
      fontScale: bigger ? Math.min(1.3, round2(scale + 0.15)) : Math.max(0.85, round2(scale - 0.1)),
    },
  ];
};

const fontFamilyRule: Rule = (clause) => {
  const m =
    clause.match(/^(?:把)?字体(?:换成|改成|改为|用)(系统|衬线|等宽|默认)(?:字体)?$/) ??
    clause.match(/^(?:use|switch to) (?:the |a )?(system|serif|mono(?:spaced?)?|default) font$/i);
  if (!m) return null;
  const font = /系统|system/i.test(m[1]!)
    ? 'system'
    : /衬线|serif/i.test(m[1]!)
      ? 'serif'
      : /等宽|mono/i.test(m[1]!)
        ? 'mono'
        : 'clay';
  return [{ op: 'setTheme', font }];
};

const radiusRule: Rule = (clause, state) => {
  const r = state.config.theme.radius;
  if (/^(?:去掉圆角|不要圆角|直角|方角)(?:卡片)?$|^(?:square|sharp) corners$/i.test(clause)) {
    return [{ op: 'setTheme', radius: 0 }];
  }
  if (/^(?:卡片)?圆角(?:再)?小一?(?:点|些)$|^(?:less rounded|sharper) corners$/i.test(clause)) {
    return [{ op: 'setTheme', radius: Math.max(0, r - 8) }];
  }
  if (/^(?:卡片)?圆角(?:再)?大一?(?:点|些)$|^(?:more rounded|rounder) corners$/i.test(clause)) {
    return [{ op: 'setTheme', radius: Math.min(28, r + 6) }];
  }
  return null;
};

const densityRule: Rule = (clause) => {
  if (
    /^(?:布局|界面|间距)?(?:更)?(?:紧凑|密集)(?:一点|一些|些)?(?:的布局)?$|^(?:more )?compact(?: layout)?$/i.test(
      clause,
    )
  ) {
    return [{ op: 'setTheme', density: 'compact' }];
  }
  if (
    /^(?:布局|界面|间距)?(?:更)?(?:宽松|疏朗)(?:一点|一些|些)?(?:的布局)?$|^(?:more )?spacious(?: layout)?$|^roomier(?: layout)?$/i.test(
      clause,
    )
  ) {
    return [{ op: 'setTheme', density: 'spacious' }];
  }
  return null;
};

const cardStyleRule: Rule = (clause) => {
  if (/^(?:去掉|不要|取消)(?:卡片)?(?:的)?阴影$|^(?:remove|no) (?:card )?shadows?$/i.test(clause)) {
    return [{ op: 'setTheme', cardStyle: 'flat' }];
  }
  if (
    /^(?:卡片)?(?:加|加上|用|改成|改为)(?:边框|描边)$|^(?:outlined? cards|card (?:borders|outlines))$/i.test(
      clause,
    )
  ) {
    return [{ op: 'setTheme', cardStyle: 'outline' }];
  }
  if (/^(?:卡片)?(?:加上|恢复)阴影$|^(?:add )?(?:card )?shadows$/i.test(clause)) {
    return [{ op: 'setTheme', cardStyle: 'shadow' }];
  }
  const m =
    clause.match(
      /^卡片(?:改成|改为|换成|用)(新粗野|粗野|新拟物|拟物|浮雕|黏土|粘土|毛玻璃|玻璃|霓虹发光|霓虹|发光|金属|Y2K)(?:风格|样式|风|质感|效果)?$/i,
    ) ??
    clause.match(
      /^(neubrutalist|brutalist|neumorphic|claymorphic|clay|puffy|glass|frosted glass|neon|glowing|chrome|metallic) cards$/i,
    );
  if (m) {
    const word = m[1]!;
    const cardStyle = /粗野|brutal/i.test(word)
      ? 'brutal'
      : /拟物|浮雕|neumorphic/i.test(word)
        ? 'soft'
        : /玻璃|glass/i.test(word)
          ? 'glass'
          : /霓虹|发光|neon|glow/i.test(word)
            ? 'glow'
            : /金属|Y2K|chrome|metallic/i.test(word)
              ? 'chrome'
              : 'puffy';
    return [{ op: 'setTheme', cardStyle }];
  }
  return null;
};

const backdropRule: Rule = (clause) => {
  const m =
    clause.match(/^(?:页面)?背景(?:改成|改为|换成|用)(渐变|极光|纯色)(?:色|背景|效果)?$/) ??
    clause.match(/^(?:use (?:a |an )?)?(gradient|aurora|solid) (?:page )?background$/i);
  if (!m) return null;
  const backdrop = /渐变|gradient/i.test(m[1]!)
    ? 'gradient'
    : /极光|aurora/i.test(m[1]!)
      ? 'aurora'
      : 'plain';
  return [{ op: 'setTheme', backdrop }];
};

/** 风格预设的叫法（小写比较）。只认整体风格；「卡片改成新粗野」之类只改卡片，见 cardStyleRule。 */
const PRESET_ALIASES: Record<ThemePresetId, string[]> = {
  ios: ['ios', 'ios原生', 'ios 原生', '苹果', '苹果原生', 'apple'],
  material: ['material', 'material you', 'material design', '安卓', '谷歌'],
  editorial: ['杂志', '报刊', '编辑', 'editorial', 'magazine'],
  pastel: ['马卡龙', '粉彩', '柔和', 'pastel'],
  nature: ['自然', '大地', '森林', 'nature', 'earthy'],
  terminal: ['终端', '极客', '程序员', '代码', 'terminal', 'hacker'],
  neon: ['霓虹', '赛博', '赛博朋克', '赛博霓虹', 'neon', 'cyberpunk'],
  claymorphism: ['黏土', '粘土', 'claymorphism', 'claymorphic'],
  brutalist: ['新粗野', '粗野', '野兽派', 'brutalist', 'neubrutalism', 'neubrutalist'],
  neumorphism: ['新拟物', '拟物', 'neumorphism', 'neumorphic', 'soft ui'],
};

const presetRule: Rule = (clause) => {
  const m =
    clause.match(
      /^(?:把)?(?:整体|整个)?(?:风格|样式|主题|外观|界面)?(?:换成|改成|改为|切换到|切换成|变成|用)(.+?)(?:的)?(?:风格|风|样式|主题|预设)?$/,
    ) ??
    clause.match(/^(?:switch to |use |make it |apply )?(?:an? |the )?(.+?) (?:style|theme|look)$/i);
  if (!m) return null;
  const name = m[1]!.trim().toLowerCase();
  const preset = THEME_PRESET_IDS.find((id) => PRESET_ALIASES[id].includes(name));
  return preset ? [{ op: 'applyThemePreset', preset }] : null;
};

const resetStyleRule: Rule = (clause) =>
  /^(?:恢复|还原)(?:成|到|为)?默认(?:的)?(?:样式|风格|主题|外观)$|^(?:样式|风格|主题)(?:恢复|还原)(?:成|到|为)?默认$|^reset (?:the )?(?:style|theme|look)$/i.test(
    clause,
  )
    ? [{ op: 'resetTheme' }]
    : null;

const PROTECTED_MESSAGE = (locale: Locale) =>
  say(
    locale,
    '「设置」不能移除：「AI 修改」和「历史」入口都在设置里，去掉它就无法继续修改或撤销了。可以把它改为浮动按钮。',
    'Settings can’t be removed: it holds the AI and History entries, so without it you couldn’t change or undo anything. You can make it a floating button instead.',
  );

/** 从导航栏和浮动按钮里去掉一个入口（AI 修改、历史和工具都可以去掉，设置页里仍有入口）。 */
const removeEntryRule: Rule = (clause, state) => {
  const m =
    clause.match(
      /^(?:把|将)?(.+?)(?:从(?:底部)?导航(?:栏)?(?:里|中|上)?)?(?:删掉|删除|去掉|移除|拿掉|隐藏)$/,
    ) ??
    clause.match(/^(?:删掉|删除|去掉|移除|拿掉|隐藏)(.+?)(?:入口|按钮)?$/) ??
    clause.match(
      /^(?:remove|hide|delete) (?:the )?(.+?)(?: from the (?:nav|navigation)(?: bar)?)?$/i,
    );
  if (!m) return null;
  const target = findNavItem(m[1]!, state);
  if (target === null) return null;
  if (target === 'settings') throw new Rejection('protected', PROTECTED_MESSAGE(state.ctx.locale));
  const { nav, floating } = state.config.shell;
  const ops: Op[] = [];
  if (nav.includes(target)) {
    const items = nav.filter((t) => t !== target);
    if (items.length === 0) {
      throw new Rejection(
        'unknown',
        say(
          state.ctx.locale,
          '导航栏至少要保留一项。',
          'The navigation bar needs at least one entry.',
        ),
      );
    }
    ops.push({ op: 'setNavItems', items });
  }
  if (floating.includes(target)) {
    ops.push({ op: 'setFloatingItems', items: floating.filter((t) => t !== target) });
  }
  return ops;
};

const floatingRule: Rule = (clause, state) => {
  const m =
    clause.match(/^(?:把|将)?(.+?)(?:做成|改成|改为|变成|放到|放在|放进)浮动(?:按钮|入口)$/) ??
    clause.match(/^(?:make|turn) (?:the )?(.+?) (?:into )?a floating button$/i);
  if (!m) return null;
  const target = findNavItem(m[1]!, state);
  if (target === null) return null;
  const { floating } = state.config.shell;
  if (floating.includes(target)) return [];
  if (floating.length >= 3) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        '最多只能有 3 个浮动按钮。',
        'There can be at most 3 floating buttons.',
      ),
    );
  }
  return [{ op: 'setFloatingItems', items: [...floating, target] }];
};

function newPageId(state: State): string {
  for (let n = 1; ; n++) {
    const id = `page-${n}`;
    if (!state.config.pages.some((p) => p.id === id)) return id;
  }
}

const addPageRule: Rule = (clause, state) => {
  const m =
    clause.match(/^(?:新建|添加|加|增加|创建)(?:一个|个)?(?:叫|名为|名叫)"?(.+?)"?(?:的)?页面$/) ??
    clause.match(/^(?:新建|添加|加|增加|创建)(?:一个|个)?页面(?:叫|名为|名叫)"?(.+?)"?$/) ??
    clause.match(/^(?:新建|添加|加|增加|创建)(?:一个|个)?"(.+?)"页面$/) ??
    clause.match(/^(?:add|create) (?:a )?(?:new )?page (?:called|named) "?(.+?)"?$/i);
  if (!m) return null;
  const title = m[1]!.trim();
  if (title.length === 0 || title.length > 40) return null;
  if (state.config.pages.some((p) => p.title === title)) {
    throw new Rejection(
      'noChange',
      say(
        state.ctx.locale,
        `已经有「${title}」页面了。`,
        `There is already a page called “${title}”.`,
      ),
    );
  }
  const id = newPageId(state);
  IdSchema.parse(id);
  const ops: Op[] = [
    {
      op: 'addPage',
      page: {
        id,
        title,
        icon: 'star',
        components: [{ id: 'header', type: 'header', props: { title } }],
      },
    },
  ];
  ops.push(...entryOps(state.config, id, title, 'star'));
  return ops;
};

const removePageRule: Rule = (clause, state) => {
  const m =
    clause.match(/^(?:删除|删掉|去掉|移除)(?:「|")?(.+?)(?:」|")?(?:这个)?页面$/) ??
    clause.match(/^(?:把|将)?(?:「|")?(.+?)(?:」|")?页面(?:删除|删掉|去掉|移除)$/) ??
    clause.match(/^(?:delete|remove) (?:the )?(.+?) page$/i);
  if (!m) return null;
  const name = m[1]!.replace(/"/g, '').trim().toLowerCase();
  const target = state.config.pages.find((p) => p.title.toLowerCase() === name);
  if (!target) return null;
  if (target.id === HOME_PAGE_ID) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        '首页不能删除，可以改名或调整内容。',
        'The home page can’t be removed, but you can rename or change it.',
      ),
    );
  }
  if (target.toolId !== undefined) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        '这是工具的页面，请在「工具」里卸载该工具。',
        'This page belongs to a tool. Uninstall the tool from Tools instead.',
      ),
    );
  }
  return [{ op: 'removePage', pageId: target.id }];
};

const TEMPLATE_WORDS: [RegExp, DataTemplate][] = [
  [/^(?:记账|账本|记账本|budget|expenses?|expense tracker)$/i, 'budget'],
  [/^(?:待办|待办清单|待办事项|to-?do|to-?do list|tasks?)$/i, 'todo'],
  [/^(?:读书清单|书单|阅读清单|reading list|books?)$/i, 'reading'],
  [/^(?:笔记|笔记本|notes?)$/i, 'notes'],
];

/** 内置数据页面模板：「新建一个记账页面」「Create a to-do list」。 */
const templateRule: Rule = (clause, state) => {
  const m =
    clause.match(/^(?:新建|添加|加|增加|创建|做|建)(?:一个|个)?(.+?)(?:页面|页)?$/) ??
    clause.match(/^(?:add|create|make)(?: me)? (?:a |an )?(.+?)(?: page)?$/i);
  if (!m) return null;
  const word = m[1]!.trim();
  const template = TEMPLATE_WORDS.find(([re]) => re.test(word))?.[1];
  if (!template) return null;
  return templateOps(template, state.config, state.ctx.locale);
};

function newFieldId(fields: readonly { id: string }[]): string {
  for (let n = 1; ; n++) if (!fields.some((f) => f.id === `field-${n}`)) return `field-${n}`;
}

/** 「给账目加一个「支付方式」字段」：加一个文字字段。 */
const addFieldRule: Rule = (clause, state) => {
  const m =
    clause.match(
      /^(?:给|在)"?(.+?)"?(?:里|中|表)?(?:加|添加|增加)(?:一个|个)?"(.+?)"(?:字段|栏|项)$/,
    ) ?? clause.match(/^add (?:a )?"?(.+?)"? field to (?:the )?"?(.+?)"?$/i);
  if (!m) return null;
  const [table, name] = /^add/i.test(clause) ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
  const collection = state.config.collections.find(
    (c) => c.name.toLowerCase() === table.trim().toLowerCase(),
  );
  if (!collection) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        `找不到数据表「${table}」。`,
        `There is no data table called “${table}”.`,
      ),
    );
  }
  return [
    {
      op: 'addField',
      collectionId: collection.id,
      field: { id: newFieldId(collection.fields), name: name.trim(), type: 'text' },
    },
  ];
};

function findPage(rawName: string, state: State): Page | undefined {
  const name = rawName
    .trim()
    .replace(/^(?:把|将|the)\s*/i, '')
    .trim()
    .toLowerCase();
  if (/^(?:首页|主页|home)(?: ?page)?$/.test(name)) return page(state, HOME_PAGE_ID);
  const title = name.replace(/\s*(?:页面|页|page)$/i, '').trim();
  return state.config.pages.find((p) => [name, title].includes(p.title.toLowerCase()));
}

function newComponentId(prefix: string, p: Page): string {
  const ids = new Set(
    p.components.flatMap((c) =>
      c.type === 'group' ? [c.id, ...c.children.map((x) => x.id)] : [c.id],
    ),
  );
  for (let n = 1; ; n++) if (!ids.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
}

/** 「在首页顶部加一张图片」：放一个图片位，照片由用户自己选（D-045）。 */
const imageRule: Rule = (clause, state) => {
  const zh = clause.match(
    /^(?:在|给)?(.+?)(?:的)?(顶部|最上面|开头|上面|底部|最下面|下面)?(?:加|添加|放|增加)(?:一张|一个|张|个)?(?:大)?(图片|照片|横幅|头图|封面|配图)$/,
  );
  const en = clause.match(
    /^add (?:an? )?(?:image|photo|picture|banner)(?: (?:at the (top|bottom) of|to) (?:the )?(.+?))?$/i,
  );
  if (!zh && !en) return null;
  const target = zh ? findPage(zh[1]!, state) : findPage(en![2] ?? 'home', state);
  if (!target) return null;
  const where = zh ? zh[2] : en![1];
  const top = where !== undefined && /顶部|最上面|开头|上面|top/i.test(where);
  const wide = zh ? /横幅|头图|封面/.test(zh[3]!) : /banner/i.test(clause);
  return [
    {
      op: 'addComponent',
      pageId: target.id,
      index: top ? topIndex(target) : target.components.length,
      component: {
        id: newComponentId('image', target),
        type: 'image',
        props: {
          aspect: wide || top ? 'wide' : 'landscape',
          fit: 'cover',
          placeholder: say(state.ctx.locale, '点按选择一张照片', 'Tap to choose a photo'),
        },
      },
    },
  ];
};

/** 「把记账页面的图标换成💰」 */
const pageIconRule: Rule = (clause, state) => {
  const m =
    clause.match(/^(?:把|将)?(.+?)的图标(?:换成|改成|改为|设为|用)(.+)$/) ??
    clause.match(/^(?:change|set) the icon of (.+?) to (.+)$/i);
  if (!m) return null;
  const target = findPage(m[1]!, state);
  if (!target) return null;
  const icon = m[2]!.trim();
  if (!isEmoji(icon) && !(ICON_NAMES as readonly string[]).includes(icon)) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        `图标只能用一个 emoji 或内置图标，「${icon}」不行。`,
        `An icon must be a single emoji or a built-in icon; “${icon}” isn’t one.`,
      ),
    );
  }
  return [{ op: 'setPageIcon', pageId: target.id, icon }];
};

const STEP_KEYWORDS: [RegExp, string][] = [
  [/上传|选择|选文件|select|choose|upload|pick/i, 'selectFiles'],
  [/合并|merge/i, 'merge'],
  [/命名|起名|改名|name/i, 'askFileName'],
];

function toolForWorkflowClause(clause: string, state: State): ToolDefinition {
  const tool = findTool(clause, state.ctx) ?? state.mentionedTool;
  if (tool) {
    requireInstalled(tool, state);
    return tool;
  }
  const withWorkflows = state.config.tools.filter((t) =>
    state.config.workflows.some((w) => w.toolId === t.toolId),
  );
  if (withWorkflows.length === 1) return state.ctx.registry.tools.get(withWorkflows[0]!.toolId)!;
  throw new Rejection(
    'unknown',
    say(
      state.ctx.locale,
      '请说明要修改哪个工具，例如「PDF 工具」。',
      'Please say which tool to change, e.g. “the PDF tool”.',
    ),
  );
}

const simplifyRule: Rule = (clause, state) => {
  if (!/简化|步骤|simplify|steps?/i.test(clause)) return null;
  const tool = toolForWorkflowClause(clause, state);
  const keep = new Set(STEP_KEYWORDS.filter(([re]) => re.test(clause)).map(([, suffix]) => suffix));
  if (keep.size === 0) return null;
  const ops: Op[] = [];
  for (const wf of state.config.workflows.filter((w) => w.toolId === tool.id)) {
    for (const step of wf.steps) {
      const suffix = step.action.split('.')[1]!;
      // 保存是自动完成的，不算用户可见的步骤。
      if (step.action !== 'file.save' && !keep.has(suffix)) {
        ops.push({ op: 'removeWorkflowStep', workflowId: wf.id, stepId: step.id });
      }
    }
  }
  const toolPage = state.config.pages.find((p) => p.toolId === tool.id);
  for (const c of toolPage?.components ?? []) {
    if (c.type === 'text' && !c.hidden) {
      ops.push({ op: 'setComponentHidden', pageId: toolPage!.id, componentId: c.id, hidden: true });
    }
  }
  return ops;
};

const namingRule: Rule = (clause, state) => {
  const m =
    clause.match(/(?:按照|按|用|以)\s*"?([^"]+?)"?\s*(?:的?格式)?(?:来)?命名/) ??
    clause.match(
      /name (?:it|them|files?|the (?:file|result)s?)?\s*(?:as|by|after|like)\s+"?(.+?)"?$/i,
    );
  if (!m) return null;
  const template = m[1]!
    .trim()
    .replace(/日期|\bdate\b/gi, '{date:YYYY-MM-DD}')
    .replace(/时间|\btime\b/gi, '{date:HHmm}')
    .replace(/原文件名|source name/gi, '{sourceName}');
  if (!checkNameTemplate(template).ok) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        `无法使用命名规则「${m[1]}」。`,
        `Can’t use “${m[1]}” as a file name pattern.`,
      ),
    );
  }
  const tool = toolForWorkflowClause(clause, state);
  const ops: Op[] = [];
  for (const wf of state.config.workflows.filter((w) => w.toolId === tool.id)) {
    for (const step of wf.steps) {
      if (step.action === 'file.save') {
        ops.push({
          op: 'setStepParams',
          workflowId: wf.id,
          stepId: step.id,
          params: { nameTemplate: template },
        });
      } else if (step.action === 'ui.askFileName') {
        ops.push(
          /自动|automatic/i.test(clause)
            ? { op: 'removeWorkflowStep', workflowId: wf.id, stepId: step.id }
            : {
                op: 'setStepParams',
                workflowId: wf.id,
                stepId: step.id,
                params: { defaultTemplate: template },
              },
        );
      }
    }
  }
  return ops.length > 0 ? ops : null;
};

const modeRule: Rule = (clause) => {
  if (!/模式|外观|mode|appearance/i.test(clause)) return null;
  if (/深色|暗色|夜间|dark/i.test(clause)) return [{ op: 'setTheme', mode: 'dark' }];
  if (/浅色|亮色|light/i.test(clause)) return [{ op: 'setTheme', mode: 'light' }];
  if (/跟随系统|system/i.test(clause)) return [{ op: 'setTheme', mode: 'system' }];
  return null;
};

const colorRule: Rule = (clause, state) => {
  const m =
    clause.match(/主题(?:颜色|色)?\s*(?:换成|改成|改为|变成|设为|用)\s*(.+)$/) ??
    clause.match(/(?:change|set|switch|make) (?:the )?theme(?: colou?r)? (?:to )?(.+)$/i);
  if (!m) return null;
  const color = COLORS.find(([re]) => re.test(m[1]!));
  if (!color) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        `暂不支持颜色「${m[1]}」。可选：绿、蓝、红、紫、橙、粉、灰。`,
        `“${m[1]}” isn’t supported. Try green, blue, red, purple, orange, pink or gray.`,
      ),
    );
  }
  return [{ op: 'setTheme', primaryColor: color[1] }];
};

const moveTopRule: Rule = (clause, state) => {
  const m =
    clause.match(
      /^(?:把|将)?(.+?)(?:放到|放在|移到|移动到|挪到|置于)(?:最上面|最上方|最前面|顶部|第一个|第一位|最前)$/,
    ) ??
    clause.match(/^(.+?)放第一(?:个|位)?$/) ??
    clause.match(/^(?:put|move) (.+?) (?:at|to) the top$/i);
  if (!m) return null;
  const home = page(state, HOME_PAGE_ID);
  const c = resolveComponent(m[1]!, home, state);
  const toIndex = c.type === 'header' ? 0 : topIndex(withoutComponent(home, c.id));
  return [{ op: 'moveComponent', pageId: home.id, componentId: c.id, toIndex }];
};

const moveRelativeRule: Rule = (clause, state) => {
  const zh = clause.match(
    /^(?:把|将)(.+?)(?:放到|放在|移到|挪到)(.+?)(前面|之前|前|后面|之后|后)$/,
  );
  const en = clause.match(/^(?:put|move) (.+?) (before|after|above|below) (.+)$/i);
  if (!zh && !en) return null;
  const [subject, anchor, before] = zh
    ? [zh[1]!, zh[2]!, /前/.test(zh[3]!)]
    : [en![1]!, en![3]!, /before|above/i.test(en![2]!)];
  const home = page(state, HOME_PAGE_ID);
  const moving = resolveComponent(subject, home, state);
  const rest = withoutComponent(home, moving.id);
  const anchorIndex = rest.components.findIndex(
    (c) => c.id === resolveComponent(anchor, home, state).id,
  );
  return [
    {
      op: 'moveComponent',
      pageId: home.id,
      componentId: moving.id,
      toIndex: before ? anchorIndex : anchorIndex + 1,
    },
  ];
};

const visibilityRule: Rule = (clause, state) => {
  const m =
    clause.match(/^(隐藏|显示|取消隐藏|不显示)(.+)$/) ?? clause.match(/^(hide|show|unhide) (.+)$/i);
  if (!m) return null;
  const home = page(state, HOME_PAGE_ID);
  const c = resolveComponent(m[2]!, home, state);
  const hidden = /^(隐藏|不显示|hide)$/i.test(m[1]!);
  return [{ op: 'setComponentHidden', pageId: home.id, componentId: c.id, hidden }];
};

const titleRule: Rule = (clause, state) => {
  const m =
    clause.match(/^(?:把|将)?(?:首页|主页)(?:改成|改为|变成|换成|改名为|叫)(.+)$/) ??
    clause.match(/^(?:rename|change|turn) (?:the )?home(?: page)? (?:to|into) (.+)$/i);
  if (!m) return null;
  const title = m[1]!.replace(/"/g, '').trim();
  const home = page(state, HOME_PAGE_ID);
  const ops: Op[] = [{ op: 'setPageTitle', pageId: home.id, title }];
  const header = home.components.find((c) => c.type === 'header');
  if (header)
    ops.push({
      op: 'setComponentProps',
      pageId: home.id,
      componentId: header.id,
      props: { title },
    });
  return ops;
};

const RULES: Rule[] = [
  navStyleRule,
  navRule,
  resetStyleRule,
  fontSizeRule,
  fontFamilyRule,
  radiusRule,
  densityRule,
  cardStyleRule,
  backdropRule,
  presetRule,
  imageRule,
  pageIconRule,
  templateRule,
  addFieldRule,
  addPageRule,
  removePageRule,
  floatingRule,
  removeEntryRule,
  simplifyRule,
  namingRule,
  modeRule,
  colorRule,
  moveTopRule,
  moveRelativeRule,
  visibilityRule,
  titleRule,
];

/** 读、写、删、统计用户记录的请求（AI 只改界面，从不接触记录内容）。 */
const USER_DATA = new RegExp(
  [
    '^记(?:一笔|一下|个账)',
    '帮我记',
    '(?:标成|标记为|设为|改成)(?:已)?完成',
    '(?:删掉|删除|清空|清除)(?:所有|全部|上个月|这个月|今天|昨天|这些)?的?(?:账|账目|记录|待办|笔记|数据)$',
    '(?:账|账目|记录|待办|笔记|数据)(?:都|全)?(?:删掉|删除|清空|清除)$',
    '(?:花了|支出|收入|赚了)多少',
    '(?:算|统计|看看|查查|告诉我|总结)(?:一下)?我的',
    '^(?:log|record|add) (?:an? )?(?:expense|entry)\\b',
    '\\b(?:delete|clear|remove) (?:all )?(?:my )?(?:records|entries|expenses|notes|tasks)\\b',
    '\\bmark (?:all )?.*\\b(?:done|complete)\\b',
    '\\bhow much did i\\b',
  ].join('|'),
  'i',
);

const RESTORE = /^(恢复|还原)(到)?上一(次|个)|^撤销|^撤回|^undo\b|^revert\b|^go back/i;
const DELETE_FILES = /(删除|删掉|清空|清除).*文件|\b(delete|remove|erase)\b.*\bfiles?\b/i;
const PROTECTED_WORD = '(?:设置|\\bsettings?\\b)';
const REMOVE_WORD = '(?:删除|删掉|去掉|移除|隐藏|不要|\\bdelete\\b|\\bremove\\b|\\bhide\\b)';
const REMOVE_PROTECTED = new RegExp(
  `${REMOVE_WORD}.*${PROTECTED_WORD}|${PROTECTED_WORD}.*${REMOVE_WORD}`,
  'i',
);

function planClauses(clauses: string[], ctx: PlanContext): Plan {
  const state: State = { ctx, config: ctx.config, mentionedTool: findTool(clauses.join(' '), ctx) };
  const ops: Op[] = [];
  for (const clause of clauses) {
    if (DELETE_FILES.test(clause)) {
      throw new Rejection(
        'deleteFiles',
        say(
          ctx.locale,
          '修改界面不会删除文件。如需删除，请在文件列表中手动操作。',
          'Changing the app never deletes files. To delete files, do it from a file list yourself.',
        ),
      );
    }
    if (USER_DATA.test(clause)) {
      throw new Rejection(
        'userData',
        say(
          ctx.locale,
          'AI 只修改界面，不会读取或改动你记录的数据。请直接在页面上添加、修改或删除。',
          'The AI only changes the app’s interface; it never reads or changes the data you record. Add, edit or delete entries on the page itself.',
        ),
      );
    }
    if (REMOVE_PROTECTED.test(clause))
      throw new Rejection('protected', PROTECTED_MESSAGE(ctx.locale));
    const clauseOps = RULES.reduce<Op[] | null>(
      (found, rule) => found ?? rule(clause, state),
      null,
    );
    if (clauseOps === null) {
      throw new Rejection(
        'unknown',
        say(
          ctx.locale,
          `暂时无法理解「${clause}」。`,
          `Sorry, I don’t understand “${clause}” yet.`,
        ),
      );
    }
    const applied = applyOps(state.config, clauseOps, {
      registry: ctx.registry,
      locale: ctx.locale,
    });
    if (!applied.ok) throw new Rejection('unknown', applied.error);
    // 已经是目标状态的子句（例如 PDF 本来就在最上面）不产生修改。
    if (JSON.stringify(applied.config) === JSON.stringify(state.config)) continue;
    state.config = applied.config;
    ops.push(...clauseOps);
  }
  if (ops.length === 0) {
    return {
      kind: 'reject',
      reason: 'noChange',
      message: say(
        ctx.locale,
        '当前界面已经是这样了，无需修改。',
        'The app already looks like that.',
      ),
      examples: [],
    };
  }
  return { kind: 'ops', ops };
}

export function createMockAIProvider(): AIProvider {
  return {
    async plan(input, ctx) {
      const examples = EXAMPLES.map((e) => e[ctx.locale]);
      const clauses = splitClauses(input);
      if (clauses.length === 0) {
        return {
          kind: 'reject',
          reason: 'unknown',
          message: say(ctx.locale, '请输入你想怎么修改。', 'Tell me what to change.'),
          examples,
        };
      }
      if (clauses.some((c) => RESTORE.test(c))) {
        if (clauses.length === 1) return { kind: 'restorePrevious' };
        return {
          kind: 'reject',
          reason: 'unknown',
          message: say(
            ctx.locale,
            '撤销请单独说，不要和其他修改放在一句话里。',
            'Ask for undo on its own, not together with other changes.',
          ),
          examples,
        };
      }
      try {
        return planClauses(clauses, ctx);
      } catch (e) {
        if (!(e instanceof Rejection)) throw e;
        return {
          kind: 'reject',
          reason: e.reason,
          message: e.message,
          examples: e.reason === 'unknown' ? examples : [],
        };
      }
    },
  };
}
