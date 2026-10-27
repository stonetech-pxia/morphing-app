import { localize } from '../localization';
import { t } from '../messages';
import { checkNameTemplate } from '../naming';
import { applyOps, topIndex, type Op } from '../ops';
import { workflowProblems } from '../workflow/check';
import { outputTypeOf, type ValueType } from '../workflow/contract';
import { newWorkflowId, presetWorkflow } from '../workflows/presets';
import { TRANSLATE_LANGUAGE_NAMES, type TranslateLanguage } from '../tools/translate';
import {
  LANGUAGE_WORD,
  findPreset,
  findWorkflowByName,
  languageOf,
  fitSizePhrases,
  kindOfSteps,
  parseStepPhrase,
  splitStepPhrases,
  stepIdFor,
  stepsFrom,
  type PhraseKind,
  type StepPhrase,
} from './workflow-phrases';
import { THEME_PRESETS, THEME_PRESET_IDS, type ThemePresetId } from '../presets';
import type { ToolDefinition } from '../registry';
import {
  HOME_PAGE_ID,
  IdSchema,
  allComponents,
  pageIdOf,
  pageTarget,
  type Component,
  type IconName,
  type Locale,
  type Localized,
  type NavTarget,
  type Page,
  type Workflow,
  type WorkflowStep,
  type WorkspaceConfig,
  ICON_NAMES,
} from '../schema';
import { isEmoji } from '../richtext';

import {
  entryOps,
  templateCollectionOp,
  templateCollectionWithoutPage,
  templatePageOps,
  type DataTemplate,
} from '../templates';
import { homeFileEntryOps } from '../starter';
import { goalPlan } from './goals';
import { splitOps } from './kinds';
import type { AIProvider, Plan, PlanContext, RejectReason } from './types';

// 基于规则的 mock AI（§7F）。不是语言模型：只认识 docs/MOCK_AI_PHRASES.md 中的句式。
// 一句话按标点拆成若干子句；任何一个子句无法理解，整句都拒绝，绝不生成猜测性修改。

const EXAMPLES: Localized[] = [
  { zh: '把 PDF 放到最上面', en: 'Put PDF at the top', fr: 'Mettre le PDF en haut' },
  {
    zh: '导航只保留首页、工具、设置',
    en: 'Only keep Home, Tools and Settings in the navigation',
    fr: 'Ne garder que Accueil, Outils et Réglages dans la navigation',
  },
  { zh: '主题换成绿色', en: 'Change the theme color to green', fr: 'Passer le thème en vert' },
  { zh: '字体大一点', en: 'Bigger text', fr: 'Texte plus grand' },
  {
    zh: '新建一个叫「记账」的页面',
    en: 'Add a page called Budget',
    fr: 'Ajouter une page nommée « Budget »',
  },
  {
    zh: '添加签证照片快捷操作',
    en: 'Add the visa photo quick action',
    fr: 'Ajouter l’action rapide photo de visa',
  },
  { zh: '撤销刚才的修改', en: 'Undo the last change', fr: 'Annuler la dernière modification' },
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
  /** 这个子句做完功能后剩下的外观请求（D-191），例如建好数据表后的「增加记账页面」。 */
  next?: string;
}

const say = (locale: Locale, zh: string, en: string) => (locale === 'zh' ? zh : en);

/** 「新建一个工作流：选照片，压到 500KB，分享」：冒号后面的逗号是步骤之间的分隔，不拆成子句。 */
function joinWorkflowSteps(input: string): string {
  return input.replace(
    /((?:快捷操作|工作流|流程|workflow|quick action)[:：])([^。！？!?\n]*)/gi,
    (_m, head: string, rest: string) => head + rest.replace(/[，,；;]/g, '、'),
  );
}

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
        `「${tool.name.zh}」工具还没有添加，请先在「工具」里添加。`,
        `The ${tool.name.en} tool hasn’t been added yet. Add it from Tools first.`,
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
  if (/^(改动记录|历史|历史记录|历史版本|change history|history)$/.test(name)) return 'history';
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
  if (/^(改动记录|历史|历史记录|change history|history)$/.test(name)) return 'history';
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
  glass: ['毛玻璃', '玻璃', '液态玻璃', 'liquid glass', 'glass', 'glassmorphism', 'frosted glass'],
  y2k: ['y2k', 'y2k 千禧', '千禧', '千禧年', '金属', 'chrome'],
};

const presetRule: Rule = (clause) => {
  const m =
    clause.match(
      /^(?:把)?(?:整体|整个)?(?:风格|样式|主题|外观|界面)?(?:换成|改成|改为|切换到|切换成|变成|用)(.+?)(?:的)?(?:风格|风|样式|主题|预设)?$/,
    ) ??
    clause.match(
      /^(?:switch to |use |make it |apply )?(?:an? |the )?(.+?) (?:style|theme|look)$/i,
    ) ??
    // 法语界面的风格选择器发的句子（presetRequest，D-234）：内置规则别的法语都不认（P-037）。
    clause.match(/^passer au style (.+)$/i);
  if (!m) return null;
  const name = m[1]!.trim().toLowerCase();
  const preset = THEME_PRESET_IDS.find(
    (id) =>
      PRESET_ALIASES[id].includes(name) ||
      localize(THEME_PRESETS[id].name, 'fr').toLowerCase() === name,
  );
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
    '「设置」不能移除：「AI 修改」和「改动记录」入口都在设置里，去掉它就无法继续修改或撤销了。可以把它改为浮动按钮。',
    'Settings can’t be removed: it holds the AI and Change history entries, so without it you couldn’t change or undo anything. You can make it a floating button instead.',
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
        '这是工具的页面，请在「工具」里移除这个工具。',
        'This page belongs to a tool. Remove the tool from Tools instead.',
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

/** 预设里说的模板名字：「增加记账页面」「Add a budget page」又会回到 templateRule。 */
const TEMPLATE_NAMES: Record<DataTemplate, Localized> = {
  budget: { zh: '记账', en: 'budget', fr: 'Budget' },
  todo: { zh: '待办', en: 'to-do list', fr: 'liste de tâches' },
  reading: { zh: '读书清单', en: 'reading list', fr: 'liste de lecture' },
  notes: { zh: '笔记', en: 'notes', fr: 'notes' },
};

/**
 * 内置数据页面模板：「新建一个记账页面」「Create a to-do list」。数据表是功能、页面是外观（D-191）：
 * 先只建数据表，页面留作下一句；数据表已经建好、还没有页面时，这句话就是加页面。
 */
const templateRule: Rule = (clause, state) => {
  const m =
    clause.match(/^(?:新建|添加|加|增加|创建|做|建)(?:一个|个)?(.+?)(?:页面|页)?$/) ??
    clause.match(/^(?:add|create|make)(?: me)? (?:a |an )?(.+?)(?: page)?$/i);
  if (!m) return null;
  const word = m[1]!.trim();
  const template = TEMPLATE_WORDS.find(([re]) => re.test(word))?.[1];
  if (!template) return null;
  const { config, ctx } = state;
  const waiting = templateCollectionWithoutPage(template, config);
  if (waiting) return templatePageOps(template, config, ctx.locale, waiting);
  const name = localize(TEMPLATE_NAMES[template], ctx.locale);
  state.next = say(ctx.locale, `增加${name}页面`, `Add a ${name} page`);
  return [templateCollectionOp(template, config, ctx.locale)];
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

const STEP_KEYWORDS: [RegExp, string[]][] = [
  [/上传|选择|选文件|select|choose|upload|pick/i, ['in.files', 'in.photos']],
  [/合并|merge/i, ['pdf.merge']],
  [/命名|起名|改名|name/i, ['file.rename']],
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
  const keep = new Set(STEP_KEYWORDS.filter(([re]) => re.test(clause)).flatMap(([, ids]) => ids));
  if (keep.size === 0) return null;
  const ops: Op[] = [];
  // 只改含有这些步骤的工作流（例如「上传和合并」只改合并流程，不动拆分、加页码等单功能工作流）。
  const core = [...keep].filter((id) => !id.startsWith('in.') && id !== 'file.rename');
  const targets = state.config.workflows.filter(
    (w) => w.toolId === tool.id && core.every((id) => w.steps.some((s) => s.action === id)),
  );
  for (const wf of targets) {
    for (const step of wf.steps) {
      if (keep.has(step.action) || step.action === 'file.save') continue;
      // 命名和保存是自动完成的，不算用户可见的步骤：命名保留，只是不再询问。
      if (step.action === 'file.rename') {
        if (step.ask?.length) {
          ops.push({ op: 'setStepParams', workflowId: wf.id, stepId: step.id, ask: [] });
        }
      } else {
        ops.push({ op: 'removeWorkflowStep', workflowId: wf.id, stepId: step.id });
      }
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
  const automatic = /自动|不用问|不要问|automatic|without asking/i.test(clause);
  for (const wf of state.config.workflows.filter((w) => w.toolId === tool.id)) {
    for (const step of wf.steps) {
      if (step.action !== 'file.rename') continue;
      ops.push({
        op: 'setStepParams',
        workflowId: wf.id,
        stepId: step.id,
        params: { template },
        ...(automatic && step.ask?.length ? { ask: [] } : {}),
      });
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

// ---- 工作流（W1–W8，T7）：新建、从预设添加、改名、删除、放到首页、加一步、改大小、去掉一步 ----

const Q = '"?';

/** 句子里说的工作流：先按名字找，再按预设找（「签证照片」→ 从签证预设添加的那个）。 */
function workflowNamed(rawName: string, state: State): Workflow | undefined {
  // 从一个快捷操作打开 AI 时（D-124），「这个」「它」就是那个快捷操作。
  const about = state.ctx.about;
  if (about?.kind === 'workflow' && THIS.test(rawName.replace(/"/g, '').trim())) {
    return state.config.workflows.find((w) => w.id === about.workflowId);
  }
  const byName = findWorkflowByName(rawName, state.config);
  if (byName) return byName;
  const preset = findPreset(rawName);
  return preset ? state.config.workflows.find((w) => w.presetId === preset.id) : undefined;
}

function requireWorkflow(rawName: string, state: State): Workflow {
  const wf = workflowNamed(rawName, state);
  if (wf) return wf;
  throw new Rejection(
    'unknown',
    say(
      state.ctx.locale,
      `没有叫「${rawName.replace(/"/g, '').trim()}」的快捷操作。`,
      `There is no quick action called “${rawName.replace(/"/g, '').trim()}”.`,
    ),
  );
}

function stepPhrases(text: string, state: State, before: PhraseKind | null = null): StepPhrase[] {
  const phrases = splitStepPhrases(text).map((p) => {
    const step = parseStepPhrase(p, state.ctx.locale);
    if (step?.table !== undefined) return withTable(step, state);
    if (step) return step;
    throw new Rejection(
      'unknown',
      say(state.ctx.locale, `不认识步骤「${p}」。`, `I don’t know the step “${p}”.`),
    );
  });
  return fitSizePhrases(phrases, before);
}

/**
 * 记一笔（D-187）：句子里的表名换成 collectionId。没说表名、只有一张表时用它；找不到时整句拒绝
 * （AI 不替用户建表：先说「新建一个记账页面」）。
 */
function withTable(step: StepPhrase, state: State): StepPhrase {
  const name = step.table!.toLowerCase();
  const all = state.config.collections;
  const collection = name
    ? (all.find((c) => c.name.toLowerCase() === name) ??
      all.find((c) => c.name.toLowerCase().includes(name) || name.includes(c.name.toLowerCase())))
    : all.length === 1
      ? all[0]
      : undefined;
  if (!collection) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        step.table
          ? `没有叫「${step.table}」的数据表。可以先说「新建一个记账页面」。`
          : '要记到哪张数据表？例如「记到账目」。',
        step.table
          ? `There is no data table called “${step.table}”. Try “Create a budget page” first.`
          : 'Which data table should it go into? For example “add a record to Expenses”.',
      ),
    );
  }
  return { action: step.action, params: { collectionId: collection.id } };
}

/**
 * 记一笔收文件时表里要有附件字段（D-187）：没有就先加一个「附件」字段（结构修改，不碰记录）。
 */
function recordFieldOps(steps: readonly WorkflowStep[], state: State): Op[] {
  const ops: Op[] = [];
  let value: ValueType | null = null;
  for (const step of steps) {
    const action = state.ctx.registry.actions.get(step.action);
    if (step.action === 'out.addRecord' && value !== 'text' && value !== null) {
      const collection = state.config.collections.find((c) => c.id === step.params.collectionId);
      if (collection && !collection.fields.some((f) => f.type === 'file')) {
        let id = 'attachment';
        for (let i = 2; collection.fields.some((f) => f.id === id); i++) id = `attachment-${i}`;
        ops.push({
          op: 'addField',
          collectionId: collection.id,
          field: { id, name: say(state.ctx.locale, '附件', 'Attachment'), type: 'file' },
        });
      }
    }
    if (action) value = outputTypeOf(action, step.params, value);
  }
  return ops;
}

/** 步骤接不上（例如 PDF 之后存到相册）时整句拒绝，说明是哪一步。 */
function requireWorkable(wf: Workflow, state: State): void {
  const problem = workflowProblems(wf, state.ctx.registry)[0];
  if (!problem) return;
  const step = wf.steps.find((s) => s.id === problem.stepId);
  const label = step
    ? (localize(state.ctx.registry.actions.get(step.action)?.label, state.ctx.locale) ??
      step.action)
    : '';
  throw new Rejection(
    'unknown',
    say(
      state.ctx.locale,
      problem.code === 'source'
        ? '快捷操作的第一步要选照片、选文件或拍照。'
        : `「${label}」接不上前一步（类型不对或参数不完整）。`,
      problem.code === 'source'
        ? 'A quick action has to start by choosing photos or files, or taking photos.'
        : `“${label}” doesn’t fit after the step before it.`,
    ),
  );
}

const addPresetRule: Rule = (clause, state) => {
  const m =
    clause.match(
      /^(?:添加|加上|新增|加一个|添加一个)(?:预设)?(.+?)(?:预设|快捷操作|工作流|流程)$/,
    ) ?? clause.match(/^add (?:the )?(.+?) (?:preset|workflow|quick action)$/i);
  if (!m) return null;
  const preset = findPreset(m[1]!);
  if (!preset) return null;
  // 已经添加过就不再重复（整句没有修改时会提示「已经是这样了」）。
  if (state.config.workflows.some((w) => w.presetId === preset.id)) return [];
  const id = newWorkflowId(preset.id, state.config.workflows);
  return [{ op: 'addWorkflow', workflow: presetWorkflow(preset, state.ctx.locale, id) }];
};

const newWorkflowRule: Rule = (clause, state) => {
  const m =
    clause.match(
      /^(?:新建|创建|做|建)(?:一个)?(?:叫"?(.+?)"?的)?(?:快捷操作|工作流|流程)[:：]\s*(.+)$/,
    ) ??
    clause.match(
      /^(?:create|make|add|new) (?:a )?(?:new )?(?:workflow|quick action)(?: called "?(.+?)"?)?:\s*(.+)$/i,
    );
  if (!m) return null;
  const steps = stepsFrom(stepPhrases(m[2]!, state));
  let name = m[1]?.trim() || say(state.ctx.locale, '我的快捷操作', 'My quick action');
  for (let i = 2; state.config.workflows.some((w) => w.name === name); i++) {
    name = `${m[1]?.trim() || say(state.ctx.locale, '我的快捷操作', 'My quick action')} ${i}`;
  }
  const wf: Workflow = {
    id: newWorkflowId(m[1] ?? 'my-workflow', state.config.workflows),
    name,
    steps,
  };
  if (!/^[a-z]/.test(wf.id) || wf.id === 'workflow') {
    wf.id = newWorkflowId('my-workflow', state.config.workflows);
  }
  requireWorkable(wf, state);
  return [...recordFieldOps(steps, state), { op: 'addWorkflow', workflow: wf }];
};

const renameWorkflowRule: Rule = (clause, state) => {
  const m =
    clause.match(
      new RegExp(
        `^(?:把|将)${Q}(.+?)${Q}(?:快捷操作|工作流|流程)?(?:改名为|改名成|重命名为|改叫|改名叫)${Q}(.+?)${Q}$`,
      ),
    ) ?? clause.match(/^rename (?:the )?"?(.+?)"? (?:workflow|quick action) to "?(.+?)"?$/i);
  if (!m) return null;
  const wf = workflowNamed(m[1]!, state);
  if (!wf) return null;
  return [{ op: 'renameWorkflow', workflowId: wf.id, name: m[2]!.replace(/"/g, '').trim() }];
};

const removeWorkflowRule: Rule = (clause, state) => {
  const m =
    clause.match(
      new RegExp(`^(?:删除|删掉|去掉|移除)${Q}(.+?)${Q}(?:这个)?(?:快捷操作|工作流|流程)$`),
    ) ??
    clause.match(
      new RegExp(`^(?:把|将)${Q}(.+?)${Q}(?:快捷操作|工作流|流程)(?:删除|删掉|去掉|移除)$`),
    ) ??
    clause.match(/^(?:delete|remove) (?:the )?"?(.+?)"? (?:workflow|quick action)$/i);
  if (!m) return null;
  const wf = requireWorkflow(m[1]!, state);
  if (wf.toolId) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        `「${wf.name}」是工具自带的，不能单独删除；可以去掉其中的步骤，或者移除工具。`,
        `“${wf.name}” comes with a tool and can’t be deleted on its own; remove its steps or remove the tool instead.`,
      ),
    );
  }
  return [{ op: 'removeWorkflow', workflowId: wf.id }];
};

const workflowToHomeRule: Rule = (clause, state) => {
  const m =
    clause.match(
      new RegExp(
        `^(?:把|将)${Q}(.+?)${Q}(?:快捷操作|工作流|流程)?(?:放到|加到|添加到|放在)(?:首页|主页)(?:上)?$`,
      ),
    ) ??
    clause.match(
      /^(?:put|add) (?:the )?"?(.+?)"?(?: workflow| quick action)? (?:on|to) (?:the )?home(?: page)?$/i,
    );
  if (!m) return null;
  const ops: Op[] = [];
  let wf = workflowNamed(m[1]!, state);
  if (!wf) {
    // 还没添加的预设：先添加再放到首页。
    const preset = findPreset(m[1]!);
    if (!preset) return null;
    wf = presetWorkflow(preset, state.ctx.locale, newWorkflowId(preset.id, state.config.workflows));
    ops.push({ op: 'addWorkflow', workflow: wf });
  }
  const home = page(state, HOME_PAGE_ID);
  if (
    allComponents(home).some((c) => c.type === 'workflowRunner' && c.props.workflowId === wf.id)
  ) {
    return ops;
  }
  ops.push({
    op: 'addComponent',
    pageId: HOME_PAGE_ID,
    index: topIndex(home),
    component: {
      id: newComponentId(`run-${wf.id}`.slice(0, 40), home),
      type: 'workflowRunner',
      props: { workflowId: wf.id },
    },
  });
  return ops;
};

const OUTPUT_ACTIONS = /^(out\.|file\.save$|file\.rename$)/;

const addStepRule: Rule = (clause, state) => {
  const m =
    clause.match(
      new RegExp(
        `^(?:在|给)${Q}(.+?)${Q}(?:快捷操作|工作流|流程)?(?:里|中|最后|后面)*(?:加|添加|增加)(?:一步|一个步骤)[:：]?\\s*(.+)$`,
      ),
    ) ??
    clause.match(/^add (?:a )?step to (?:the )?"?(.+?)"?(?: workflow| quick action)?:\s*(.+)$/i) ??
    clause.match(/^in (?:the )?"?(.+?)"? (?:workflow|quick action),? add (?:a step:? )?(.+)$/i);
  if (!m) return null;
  const wf = requireWorkflow(m[1]!, state);
  // 「压到 N MB」按快捷操作里处理的是视频、PDF 还是图片来选动作。
  const phrases = stepPhrases(m[2]!, state, kindOfSteps(wf.steps));
  // 处理类的步骤插在结尾的命名 / 保存 / 分享之前；输出类的放在最后。
  let index = wf.steps.length;
  const ops: Op[] = [];
  const steps = [...wf.steps];
  for (const p of phrases) {
    if (!OUTPUT_ACTIONS.test(p.action)) {
      while (index > 1 && OUTPUT_ACTIONS.test(steps[index - 1]!.action)) index--;
    } else index = steps.length;
    const step = { id: stepIdFor(p.action, steps), action: p.action, params: p.params };
    steps.splice(index, 0, step);
    ops.push({ op: 'addWorkflowStep', workflowId: wf.id, step, index });
    index++;
  }
  requireWorkable({ ...wf, steps }, state);
  return ops;
};

const setSizeRule: Rule = (clause, state) => {
  const m =
    clause.match(
      new RegExp(
        `^(?:把)?${Q}(.+?)${Q}(?:快捷操作|工作流|流程)?(?:的)?(?:压缩|大小|文件大小)?(?:改成|改为|压到|不超过)\\s*(\\d+(?:\\.\\d+)?\\s*(?:kb|mb|k|m|兆))$`,
        'i',
      ),
    ) ??
    clause.match(
      /^(?:make|set|compress) (?:the )?"?(.+?)"?(?: workflow| quick action)? (?:to|under|size to) (\d+(?:\.\d+)?\s*(?:kb|mb))$/i,
    );
  if (!m) return null;
  const wf = workflowNamed(m[1]!, state);
  if (!wf) return null;
  const sizeMatch = /(\d+(?:\.\d+)?)\s*(kb|mb|k|m|兆)/i.exec(m[2]!)!;
  const value = Number(sizeMatch[1]);
  const isMB = /^(mb|m|兆)$/i.test(sizeMatch[2]!);
  const ops: Op[] = [];
  for (const step of wf.steps) {
    if (step.action === 'image.compress' || step.action === 'image.idPhoto') {
      const maxKB = Math.round(isMB ? value * 1024 : value);
      ops.push({ op: 'setStepParams', workflowId: wf.id, stepId: step.id, params: { maxKB } });
    } else if (step.action === 'pdf.fromImages' || step.action === 'pdf.compress') {
      const mb = isMB ? value : Math.round((value / 1024) * 100) / 100;
      const maxMB = step.action === 'pdf.compress' ? Math.max(0.1, mb) : mb;
      ops.push({ op: 'setStepParams', workflowId: wf.id, stepId: step.id, params: { maxMB } });
    } else if (step.action === 'video.compress') {
      const maxMB = Math.max(1, Math.round(isMB ? value : value / 1024));
      ops.push({
        op: 'setStepParams',
        workflowId: wf.id,
        stepId: step.id,
        params: { by: 'size', maxMB },
      });
    }
  }
  if (ops.length === 0) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        `「${wf.name}」里没有控制大小的步骤，可以先加一步「压到 ${m[2]}」。`,
        `“${wf.name}” has no size step; add one first, e.g. “compress to ${m[2]}”.`,
      ),
    );
  }
  return ops;
};

const removeStepRule: Rule = (clause, state) => {
  const m =
    clause.match(
      new RegExp(
        `^(?:把|将)?${Q}(.+?)${Q}(?:快捷操作|工作流|流程)?(?:的|里的|中的)${Q}(.+?)${Q}(?:这一步|这个步骤|步骤)?(?:去掉|删掉|删除|移除)$`,
      ),
    ) ??
    clause.match(
      /^remove (?:the )?"?(.+?)"? step from (?:the )?"?(.+?)"?(?: workflow| quick action)?$/i,
    );
  if (!m) return null;
  const english = /^remove/i.test(clause);
  const [wfName, stepName] = english ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
  const wf = workflowNamed(wfName, state);
  if (!wf) return null;
  const wanted = stepName.replace(/"/g, '').trim().toLowerCase();
  const phrase = parseStepPhrase(wanted, state.ctx.locale);
  const step = wf.steps.find((s) => {
    const a = state.ctx.registry.actions.get(s.action);
    const labels = [a?.label.zh, a?.label.en].map((l) => (l ?? '').toLowerCase());
    return (
      labels.some((l) => l && (l === wanted || l.includes(wanted))) || phrase?.action === s.action
    );
  });
  if (!step) {
    throw new Rejection(
      'unknown',
      say(
        state.ctx.locale,
        `「${wf.name}」里没有「${stepName}」这一步。`,
        `“${wf.name}” has no “${stepName}” step.`,
      ),
    );
  }
  const steps = wf.steps.filter((s) => s.id !== step.id);
  if (steps.length === 0) return null;
  requireWorkable({ ...wf, steps }, state);
  return [{ op: 'removeWorkflowStep', workflowId: wf.id, stepId: step.id }];
};

const PERIOD_WORDS: [RegExp, string][] = [
  [/本月|这个月|this month/i, 'thisMonth'],
  [/今年|this year/i, 'thisYear'],
  [/本周|这周|this week/i, 'thisWeek'],
  [/今天|today/i, 'today'],
  [/最近\s*7\s*天|last 7 days/i, 'last7days'],
  [/最近\s*30\s*天|last 30 days/i, 'last30days'],
];

/** W9：用某张数据表的记录生成 PDF 报表（新建工作流；AI 不读记录，记录在本机填进模板）。 */
const reportRule: Rule = (clause, state) => {
  const m =
    clause.match(
      /^(?:把)?(.*?)的?(?:记录)?(?:做成|生成|导出成?)(?:一个|一份)?\s*pdf\s*(?:报表|清单|报告)?$/i,
    ) ?? clause.match(/^(?:make|turn) (.+?) (?:into |as )?(?:a )?pdf(?: report| list)?$/i);
  if (!m) return null;
  const words = m[1]!.replace(/"/g, '');
  const collection = state.config.collections.find(
    (c) => words.includes(c.name) || words.toLowerCase().includes(c.name.toLowerCase()),
  );
  if (!collection) return null;
  const period = PERIOD_WORDS.find(([re]) => re.test(words))?.[1] ?? 'all';
  const hasMoney = collection.fields.some((f) => f.type === 'money');
  const name = say(state.ctx.locale, `${collection.name}报表`, `${collection.name} report`);
  const wf: Workflow = {
    id: newWorkflowId(`${collection.id}-report`, state.config.workflows),
    name,
    steps: [
      { id: 'read', action: 'in.records', params: { collectionId: collection.id, period } },
      {
        id: 'pdf',
        action: 'print.records',
        params: {
          template: hasMoney ? 'receipt' : 'table',
          title: name,
          fields: [],
          pageSize: say(state.ctx.locale, 'a4', 'letter'),
        },
      },
    ],
  };
  requireWorkable(wf, state);
  return [{ op: 'addWorkflow', workflow: wf }];
};

// ---- 翻译文件（D-171、D-174）：「把这份合同翻译成英文」是文件上的事，做一个翻译快捷操作 ----

const DOC_WORD =
  '(合同|文件|pdf|材料|文档|说明书|信|通知|证明|成绩单|论文|报告|截图|照片|图片|扫描件|菜单|告示|' +
  'contract|document|pdf|file|letter|notice|certificate|transcript|report|paper|screenshot|photo|picture|image|scan|menu|sign)';
/** 文件是图片：先识别文字。 */
const IMAGE_DOC =
  /^(?:截图|照片|图片|扫描件|菜单|告示|screenshot|photo|picture|image|scan|menu|sign)$/i;
const MEASURE = '(?:这|那)?(?:一)?(?:份|个|些|张|几张|几份|封|篇|页|几页)?';
const DOC_TRANSLATE = new RegExp(
  [
    `^(?:帮我|给我)?(?:把|将)?${MEASURE}${DOC_WORD}(?:都|全部)?(?:翻译|翻|译)成\\s*${LANGUAGE_WORD}$`,
    `^(?:帮我|给我)?(?:翻译|翻)(?:一下)?${MEASURE}${DOC_WORD}()$`,
    `^translate (?:this|the|my|these|a|an) ${DOC_WORD}s?(?: (?:in)?to ${LANGUAGE_WORD})?$`,
  ].join('|'),
  'i',
);

const translateDocRule: Rule = (clause, state) => {
  const m = DOC_TRANSLATE.exec(clause.trim());
  if (!m) return null;
  const [doc, langWord] = [m[1] ?? m[3] ?? m[5]!, m[2] ?? m[4] ?? m[6]];
  const { locale } = state.ctx;
  const to = ((langWord ? languageOf(langWord) : null) ??
    (locale === 'zh' ? 'zh-Hans' : 'en')) as TranslateLanguage;
  const image = IMAGE_DOC.test(doc);
  const translate = {
    id: 'translate',
    action: 'translate.text',
    params: { from: 'auto', to },
    ...(langWord ? {} : { ask: ['to'] }),
  };
  const steps: Workflow['steps'] = image
    ? [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
        {
          id: 'read',
          action: 'ocr.recognize',
          params: { lang: to.startsWith('zh') ? 'eng' : 'chi_sim' },
          ask: ['lang'],
        },
        translate,
        { id: 'copy', action: 'text.copy', params: {} },
      ]
    : [
        { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
        { id: 'extract', action: 'pdf.extractText', params: {} },
        translate,
        { id: 'pdf', action: 'text.toPdf', params: { pageSize: 'a4', fontSize: 12 } },
        { id: 'share', action: 'out.share', params: {} },
      ];
  // 名字最长 40 个字：简体中文就叫「中文」。
  const language =
    to === 'zh-Hans'
      ? say(locale, '中文', 'Chinese')
      : localize(TRANSLATE_LANGUAGE_NAMES[to], locale);
  const base = say(
    locale,
    `${doc.toUpperCase() === 'PDF' ? 'PDF' : doc}翻成${language}`,
    `Translate ${doc} into ${language}`,
  );
  let name = base.slice(0, 36);
  for (let i = 2; state.config.workflows.some((w) => w.name === name); i++) {
    name = `${base.slice(0, 36)} ${i}`;
  }
  const wf: Workflow = {
    id: newWorkflowId(`translate-to-${to}`, state.config.workflows),
    name,
    steps,
  };
  requireWorkable(wf, state);
  return [{ op: 'addWorkflow', workflow: wf }];
};

/** 新手引导第 1 步的句子（D-231）：两个文件入口一起加，并排放。 */
const bothFilePicksRule: Rule = (clause, state) => {
  if (
    !/^(?:首页)?(?:加入|加上|添加)[「“"]打开(?:相册|图片)[」”"]和[「“"]打开文件[」”"](?:两个)?按钮$|^add the [“"]open photo library[”"] and [“"]open files[”"] buttons$/i.test(
      clause,
    )
  )
    return null;
  return homeFileEntryOps(state.config);
};

const filePickRule: Rule = (clause, state) => {
  const media = /^(?:首页加上打开相册|Add a photo picker to home)$/i.test(clause);
  const files = /^(?:首页加上打开文件|Add a file picker to home)$/i.test(clause);
  if (!media && !files) return null;
  const source = media ? 'media' : 'files';
  if (
    allComponents(page(state, HOME_PAGE_ID)).some(
      (c) => c.type === 'filePick' && c.props.source === source && !c.hidden,
    )
  )
    return [];
  const ids = new Set(allComponents(page(state, HOME_PAGE_ID)).map((c) => c.id));
  let id = `pick-${source}`;
  for (let n = 2; ids.has(id); n++) id = `pick-${source}-${n}`;
  return [
    {
      op: 'addComponent',
      pageId: HOME_PAGE_ID,
      component: { id, type: 'filePick', props: { source } },
    },
  ];
};

const quickActionsRule: Rule = (clause, state) => {
  if (!/^(?:首页加上Morph 可以做什么|Add What Morph can do to home)$/i.test(clause)) return null;
  const home = page(state, HOME_PAGE_ID);
  if (
    allComponents(home).some(
      (c) =>
        (c.type === 'shortcut' || c.type === 'button') &&
        c.props.target === 'quickActions' &&
        !c.hidden,
    )
  )
    return [];
  return [
    {
      op: 'addComponent',
      pageId: HOME_PAGE_ID,
      component: {
        id: newComponentId('what-morph-can-do', home),
        type: 'shortcut',
        props: {
          title: t(state.ctx.locale, 'mock_What_Morph_can_do_8f4f4'),
          icon: 'workflow',
          target: 'quickActions',
        },
      },
    },
  ];
};

// ---- 外观选项（D-230）：图标底色、入口和快捷操作的样子、只显示图标的按钮、快捷操作列表 ----

const iconStyleRule: Rule = (clause) => {
  const m =
    clause.match(/^图标(?:底色)?(?:改成|换成|用)(浅色|实色)(?:底)?$/) ??
    clause.match(/^(?:use )?(light|solid) icon backgrounds?$/i);
  if (!m) return null;
  return [{ op: 'setTheme', iconStyle: /浅色|light/i.test(m[1]!) ? 'tint' : 'solid' }];
};

const entryLookRule: Rule = (clause, state) => {
  const m =
    clause.match(/^首页(?:的)?入口改成(大图标|列表)(?:样式)?$/) ??
    clause.match(/^make the home (?:entries|shortcuts) (tiles|rows)$/i);
  if (!m) return null;
  const look = /大图标|tiles/i.test(m[1]!) ? 'tile' : 'row';
  return allComponents(page(state, HOME_PAGE_ID))
    .filter((c) => c.type === 'shortcut' || c.type === 'toolCard' || c.type === 'catalogLink')
    .map((c) => ({
      op: 'setComponentProps' as const,
      pageId: HOME_PAGE_ID,
      componentId: c.id,
      props: { look },
    }));
};

const runnerLookRule: Rule = (clause, state) => {
  const m =
    clause.match(/^(?:首页(?:的)?)?快捷操作改成(列表|小方块|卡片)(?:样式)?$/) ??
    clause.match(/^show (?:the )?quick actions as (rows|tiles|cards)$/i);
  if (!m) return null;
  const look = /列表|rows/i.test(m[1]!) ? 'row' : /小方块|tiles/i.test(m[1]!) ? 'tile' : 'card';
  return allComponents(page(state, HOME_PAGE_ID))
    .filter((c) => c.type === 'workflowRunner')
    .map((c) => ({
      op: 'setComponentProps' as const,
      pageId: HOME_PAGE_ID,
      componentId: c.id,
      props: { look },
    }));
};

/** 系统入口的图标，和导航栏里的一致。 */
const TARGET_ICONS: Partial<Record<NavTarget, IconName>> = {
  tools: 'apps',
  ai: 'sparkles',
  history: 'history',
  settings: 'settings',
  quickActions: 'workflow',
};

const iconButtonRule: Rule = (clause, state) => {
  if (!/^(?:首页(?:的)?)?按钮只显示图标$|^make the (?:home )?buttons icons? only$/i.test(clause))
    return null;
  return allComponents(page(state, HOME_PAGE_ID)).flatMap((c) => {
    if (c.type !== 'button') return [];
    const targetPage = pageIdOf(c.props.target);
    const icon =
      c.props.icon ??
      (targetPage ? state.config.pages.find((p) => p.id === targetPage)?.icon : undefined) ??
      TARGET_ICONS[c.props.target as NavTarget] ??
      'link';
    return [
      {
        op: 'setComponentProps' as const,
        pageId: HOME_PAGE_ID,
        componentId: c.id,
        props: { variant: 'icon', icon },
      },
    ];
  });
};

const QUICK_ACTION_LIST_KINDS = {
  照片: 'image',
  图片: 'image',
  视频: 'video',
  音频: 'audio',
  文档: 'document',
  其他: 'other',
  photo: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
  other: 'other',
} as const;

const quickActionListRule: Rule = (clause, state) => {
  const m =
    clause.match(/^首页(?:加上|显示)(照片|图片|视频|音频|文档|其他)(?:的)?快捷操作$/) ??
    clause.match(/^(?:add|show) (photo|video|audio|document|other) quick actions (?:on|to) home$/i);
  const all = /^首页显示全部快捷操作分类$|^show all quick action categories on home$/i.test(clause);
  if (!m && !all) return null;
  const kind = m
    ? QUICK_ACTION_LIST_KINDS[m[1]!.toLowerCase() as keyof typeof QUICK_ACTION_LIST_KINDS]
    : undefined;
  const home = page(state, HOME_PAGE_ID);
  if (allComponents(home).some((c) => c.type === 'quickActionList' && c.props.kind === kind))
    return [];
  return [
    {
      op: 'addComponent',
      pageId: HOME_PAGE_ID,
      component: {
        id: newComponentId(kind ? `quick-actions-${kind}` : 'quick-actions', home),
        type: 'quickActionList',
        props: kind ? { kind } : {},
      },
    },
  ];
};

const RULES: Rule[] = [
  bothFilePicksRule,
  quickActionsRule,
  iconStyleRule,
  entryLookRule,
  runnerLookRule,
  iconButtonRule,
  quickActionListRule,
  filePickRule,
  reportRule,
  translateDocRule,
  // 工作流的句式先判断：它们都要求句子里有工作流的名字或「工作流」，不会抢走其他句式。
  newWorkflowRule,
  addPresetRule,
  renameWorkflowRule,
  removeWorkflowRule,
  workflowToHomeRule,
  addStepRule,
  setSizeRule,
  removeStepRule,
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
const THIS =
  /^(?:这个|它|这一个|该)(?:快捷操作|工作流|流程)?$|^(?:this|it|this quick action|this workflow)$/i;

/**
 * 替用户办事、而不是改 App 的请求（D-113、D-128）：写东西、翻译、总结或解释内容、提问、搜索。
 * 整句检查：这类话里常有逗号，拆开后的子句看不出来。
 */
const ERRAND = new RegExp(
  [
    '^(?:请|麻烦)?(?:你)?(?:帮我|给我|替我)?(?:写|起草|拟|编)(?:一|个|封|段|篇|份|条)',
    '(?:帮我|给我)翻译|翻译(?:成|一下|这)',
    '(?:英文|英语|中文|日语|日文|韩语|韩文|法语|德语|西班牙语)怎么(?:说|讲|写)',
    '(?:总结|概括|解释|讲讲|说说)(?:一下)?(?:这|那)',
    '(?:讲了|说了|写了)(?:些)?什么|是什么意思|什么意思',
    '^(?:帮我)?(?:查|搜|搜索)(?:一下|一查)',
    '^(?:please )?(?:write|draft|compose)\\b',
    '\\btranslate\\b',
    '\\b(?:summari[sz]e|explain)\\b',
    '^(?:what|why|who|when|where)\\b',
    '^(?:search|look up|google)\\b',
  ].join('|'),
  'i',
);
/** 「现在帮我运行签证照片」：AI 不替用户运行，点快捷操作就能开始。 */
const RUN_NOW =
  /^(?:现在|马上|立刻)?(?:帮我)?(?:运行|执行|跑一下|跑一遍|开始)|^(?:please )?(?:run|start)\b/i;

/** 办事类请求的拒绝例子：都是内置规则认得的句子。 */
/** 直接要译文（「帮我翻译一下这句话：…」）：Morph 不给译文，可以做一个翻译快捷操作（D-171）。 */
const TRANSLATE_ERRAND = /翻译|翻成|译成|怎么说|\btranslat/i;
const TRANSLATE_EXAMPLES: Localized[] = [
  {
    zh: '新建一个快捷操作：输入文字，翻译成英文，复制文字',
    en: 'Create a quick action: type text, translate into Chinese, copy text',
    fr: 'Créer une action rapide : saisir du texte, le traduire en chinois, copier le texte',
  },
  {
    zh: '添加截图翻译快捷操作',
    en: 'Add the translate screenshots quick action',
    fr: 'Ajouter l’action rapide traduction de captures d’écran',
  },
  {
    zh: '新建一个快捷操作：选 PDF，提取 PDF 文字，翻译成中文，转成 PDF，分享',
    en: 'Create a quick action: choose a PDF, get text from PDF, translate into English, make a PDF, share',
    fr: 'Créer une action rapide : choisir un PDF, extraire le texte du PDF, traduire en anglais, créer un PDF, partager',
  },
];
/** 说的是改快捷操作本身（「添加截图翻译快捷操作」「新建一个快捷操作：…，翻译成英文」），不是办事。 */
const ABOUT_QUICK_ACTION = /快捷操作|工作流|\bquick action\b|\bworkflow\b/i;

const ERRAND_EXAMPLES: Localized[] = [
  {
    zh: '新建一个快捷操作：扫描文档，压到 300KB，存到文件',
    en: 'Create a quick action: scan documents, make a PDF, share',
    fr: 'Créer une action rapide : numériser des documents, créer un PDF, partager',
  },
  {
    zh: '添加签证照片快捷操作',
    en: 'Add the visa photo quick action',
    fr: 'Ajouter l’action rapide photo de visa',
  },
  {
    zh: '把照片发邮件放到首页',
    en: 'Put the photos for email quick action on the home page',
    fr: 'Placer sur l’accueil l’action rapide des photos pour e-mail',
  },
];
const DELETE_FILES = /(删除|删掉|清空|清除).*文件|\b(delete|remove|erase)\b.*\bfiles?\b/i;
const PROTECTED_WORD = '(?:设置|\\bsettings?\\b)';
const REMOVE_WORD = '(?:删除|删掉|去掉|移除|隐藏|不要|\\bdelete\\b|\\bremove\\b|\\bhide\\b)';
const REMOVE_PROTECTED = new RegExp(
  `${REMOVE_WORD}.*${PROTECTED_WORD}|${PROTECTED_WORD}.*${REMOVE_WORD}`,
  'i',
);

interface ClauseResult {
  clause: string;
  ops: Op[];
  next?: string;
}

/** 一个子句一个子句地套用规则；已经是目标状态的子句（例如 PDF 本来就在最上面）不产生修改。 */
function runClauses(clauses: string[], ctx: PlanContext): ClauseResult[] {
  const state: State = { ctx, config: ctx.config, mentionedTool: findTool(clauses.join(' '), ctx) };
  const results: ClauseResult[] = [];
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
    delete state.next;
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
    if (JSON.stringify(applied.config) === JSON.stringify(state.config)) continue;
    state.config = applied.config;
    results.push({ clause, ops: clauseOps, ...(state.next ? { next: state.next } : {}) });
  }
  return results;
}

/** 子句拼回一句话：中文用逗号，英文用句号（splitClauses 不按英文逗号拆）；引号换回「」。 */
function joinClauses(clauses: string[], locale: Locale): string {
  return locale === 'zh'
    ? clauses.map((c) => c.replace(/"([^"]*)"/g, '「$1」')).join('，')
    : clauses.join('. ');
}

function planClauses(clauses: string[], ctx: PlanContext): Plan {
  const first = runClauses(clauses, ctx);
  const ops = first.flatMap((r) => r.ops);
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
  const fn = new Set(splitOps(ops).function);
  if (fn.size === 0) return { kind: 'ops', ops };
  // 功能先做（D-191）：外观的子句不做，拼成下一句；功能的子句不带外观再算一遍。
  const isFn = (r: ClauseResult) => r.ops.some((op) => fn.has(op));
  const fnClauses = first.filter(isFn).map((r) => r.clause);
  const second = fnClauses.length === first.length ? first : runClauses(fnClauses, ctx);
  const nextOf = new Map(second.map((r) => [r.clause, r.next]));
  const rest = first.flatMap((r) => {
    if (!isFn(r)) return [r.clause];
    const next = nextOf.get(r.clause);
    return next ? [next] : [];
  });
  return {
    kind: 'ops',
    ops: splitOps(second.flatMap((r) => r.ops)).function,
    ...(rest.length > 0 ? { next: joinClauses(rest, ctx.locale).slice(0, 200) } : {}),
  };
}

export function createMockAIProvider(): AIProvider {
  return {
    async plan(input, ctx) {
      // 内置规则只识别中英文句式；法语界面使用英文示例和回复（P-037）。
      if (ctx.locale === 'fr') ctx = { ...ctx, locale: 'en' };
      const examples = EXAMPLES.map((e) => localize(e, ctx.locale));
      const clauses = splitClauses(joinWorkflowSteps(input));
      if (clauses.length === 0) {
        return {
          kind: 'reject',
          reason: 'unknown',
          message: say(ctx.locale, '请输入你想怎么修改。', 'Tell me what to change.'),
          examples,
        };
      }
      const whole = input.trim();
      if (RUN_NOW.test(whole)) {
        return {
          kind: 'reject',
          reason: 'errand',
          message: say(
            ctx.locale,
            'AI 不会替你运行快捷操作。点一下这个快捷操作就能开始。',
            'The AI doesn’t run quick actions for you. Tap the quick action to start it.',
          ),
          examples: [],
        };
      }
      const translateDoc = splitClauses(whole).some((c) => DOC_TRANSLATE.test(c));
      if (ERRAND.test(whole) && !translateDoc && !ABOUT_QUICK_ACTION.test(whole)) {
        if (TRANSLATE_ERRAND.test(whole)) {
          return {
            kind: 'reject',
            reason: 'errand',
            message: say(
              ctx.locale,
              'Morph 不会直接给出译文，它只会修改这个 App。可以做一个翻译快捷操作，以后在本机翻译文字、截图或 PDF。',
              'Morph doesn’t hand you a translation; it only changes this app. It can make a translation quick action that translates text, screenshots or PDFs on this device.',
            ),
            examples: TRANSLATE_EXAMPLES.map((e) => localize(e, ctx.locale)),
          };
        }
        return {
          kind: 'reject',
          reason: 'errand',
          message: say(
            ctx.locale,
            'Morph 不替你写东西、回答问题或总结文件内容，它只会修改这个 App。常做的事可以做成快捷操作，以后点一下就能用。',
            'Morph doesn’t write, answer questions or summarize files for you; it only changes this app. Things you do often can become quick actions you start with one tap.',
          ),
          examples: ERRAND_EXAMPLES.map((e) => localize(e, ctx.locale)),
        };
      }
      // 新手引导里的「我有什么，我想要什么」（D-149）。
      const goal = goalPlan(whole, ctx);
      if (goal) return goal;
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
