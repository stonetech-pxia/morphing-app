import { SYSTEM_TARGET_LABELS } from './defaults';
import { renderNameTemplate } from './naming';
import type { ApplyNote, Op } from './ops';
import type { Registry } from './registry';
import {
  allComponents,
  pageIdOf,
  type Component,
  type Locale,
  type NavTarget,
  type Theme,
  type WorkspaceConfig,
} from './schema';

// 把修改操作翻译成用户能看懂的说明（§4：将新增、删除或调整哪些页面/操作）。
// 描述基于修改前的配置，这样被删除或改名的对象仍能用原来的名字称呼。

export interface DescribeContext {
  registry: Registry;
  locale: Locale;
  /** 用于展示命名模板示例。 */
  now: Date;
}

export function navTargetLabel(target: NavTarget, config: WorkspaceConfig, locale: Locale): string {
  const pageId = pageIdOf(target);
  if (pageId === null)
    return SYSTEM_TARGET_LABELS[target as keyof typeof SYSTEM_TARGET_LABELS][locale];
  return config.pages.find((p) => p.id === pageId)?.title ?? pageId;
}

export function componentLabel(
  c: Component,
  config: WorkspaceConfig,
  ctx: DescribeContext,
): string {
  const zh = ctx.locale === 'zh';
  switch (c.type) {
    case 'header':
      return zh ? `标题「${c.props.title}」` : `header “${c.props.title}”`;
    case 'text':
      return zh ? '说明文字' : 'description text';
    case 'toolCard': {
      const name = ctx.registry.tools.get(c.props.toolId)?.name[ctx.locale] ?? c.props.toolId;
      return zh ? `「${name}」工具入口` : `${name} tool card`;
    }
    case 'catalogLink':
      return zh ? `「${c.props.title}」入口` : `“${c.props.title}” link`;
    case 'fileList':
      return zh ? `文件列表「${c.props.title}」` : `file list “${c.props.title}”`;
    case 'workflowRunner': {
      const wf = config.workflows.find((w) => w.id === c.props.workflowId);
      return zh
        ? `流程「${wf?.name ?? c.props.workflowId}」`
        : `workflow “${wf?.name ?? c.props.workflowId}”`;
    }
    case 'button':
      return zh ? `按钮「${c.props.label}」` : `button “${c.props.label}”`;
    case 'shortcut':
      return zh ? `快捷入口「${c.props.title}」` : `shortcut “${c.props.title}”`;
    case 'notice':
      return zh ? '提示框' : 'notice';
    case 'divider':
      return zh ? '分隔线' : 'divider';
    case 'spacer':
      return zh ? '空白间距' : 'spacer';
    case 'group': {
      const layout = {
        stack: zh ? '竖排' : 'stacked',
        row: zh ? '横排' : 'row',
        grid: zh ? '网格' : 'grid',
      }[c.props.layout];
      const name = c.props.title ? (zh ? `「${c.props.title}」` : ` “${c.props.title}”`) : '';
      return zh ? `${layout}分组${name}` : `${layout} group${name}`;
    }
  }
}

type ThemeTokenKey = Exclude<keyof Theme, 'primaryColor' | 'mode' | 'colors'>;

/** 主题 token 的名字和取值说明。 */
function describeToken(key: ThemeTokenKey, value: unknown, zh: boolean): string {
  const values: Record<string, Record<string, [string, string]>> = {
    font: {
      clay: ['默认字体（Sora + Karla）', 'the default fonts (Sora + Karla)'],
      system: ['系统字体', 'the system font'],
      serif: ['衬线字体', 'a serif font'],
      mono: ['等宽字体', 'a monospaced font'],
    },
    density: {
      compact: ['紧凑', 'compact'],
      comfortable: ['适中', 'comfortable'],
      spacious: ['宽松', 'spacious'],
    },
    cardStyle: {
      shadow: ['阴影', 'shadow'],
      outline: ['描边', 'outline'],
      flat: ['无阴影无描边', 'flat'],
    },
    navStyle: {
      iconLabel: ['图标 + 文字', 'icons and labels'],
      label: ['只显示文字', 'labels only'],
      icon: ['只显示图标', 'icons only'],
    },
  };
  const names: Record<ThemeTokenKey, [string, string]> = {
    font: ['字体', 'Font'],
    fontScale: ['字号', 'Text size'],
    radius: ['圆角', 'Corner radius'],
    density: ['间距', 'Spacing'],
    cardStyle: ['卡片样式', 'Card style'],
    navStyle: ['导航栏样式', 'Navigation bar'],
  };
  const pick = ([a, b]: [string, string]) => (zh ? a : b);
  let shown: string;
  if (key === 'fontScale') shown = `${Math.round(Number(value) * 100)}%`;
  else if (key === 'radius') shown = String(value);
  else shown = pick(values[key]?.[String(value)] ?? [String(value), String(value)]);
  return zh ? `${pick(names[key])}改为${shown}` : `${pick(names[key])} → ${shown}`;
}

export function describeChange(
  ops: readonly Op[],
  before: WorkspaceConfig,
  notes: readonly ApplyNote[],
  ctx: DescribeContext,
): string[] {
  const zh = ctx.locale === 'zh';
  const page = (id: string) => before.pages.find((p) => p.id === id);
  const pageName = (id: string) => page(id)?.title ?? id;
  // 同一次修改里新加的组件（例如先加分组再把卡片移进去）也要能用名字称呼。
  const added = ops.flatMap((op) => (op.op === 'addComponent' ? [op.component] : []));
  const findComp = (pageId: string, id: string) => {
    const p = page(pageId);
    return (
      (p ? allComponents(p).find((x) => x.id === id) : undefined) ?? added.find((x) => x.id === id)
    );
  };
  const comp = (pageId: string, id: string) => {
    const c = findComp(pageId, id);
    return c ? componentLabel(c, before, ctx) : id;
  };
  const toolName = (id: string) => ctx.registry.tools.get(id)?.name[ctx.locale] ?? id;
  const wf = (id: string) => before.workflows.find((w) => w.id === id);
  const stepLabel = (wfId: string, stepId: string) => {
    const action = wf(wfId)?.steps.find((s) => s.id === stepId)?.action;
    return (action && ctx.registry.actions.get(action)?.label[ctx.locale]) ?? stepId;
  };
  const navList = (items: readonly NavTarget[]) =>
    items.map((t) => navTargetLabel(t, before, ctx.locale)).join(zh ? '、' : ', ');
  const modeLabel = {
    light: zh ? '浅色' : 'light',
    dark: zh ? '深色' : 'dark',
    system: zh ? '跟随系统' : 'system',
  };

  const colorNames = {
    background: zh ? '背景色' : 'Background',
    surface: zh ? '卡片颜色' : 'Card color',
    text: zh ? '文字颜色' : 'Text color',
    secondary: zh ? '辅助色' : 'Secondary color',
  };
  const where = (pageId: string, parentId: string | undefined) => {
    if (parentId === undefined) return zh ? `「${pageName(pageId)}」` : `“${pageName(pageId)}”`;
    return zh
      ? `「${pageName(pageId)}」的${comp(pageId, parentId)}`
      : `${comp(pageId, parentId)} on “${pageName(pageId)}”`;
  };

  const lines: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'setTheme': {
        if (op.primaryColor)
          lines.push(zh ? `主题色改为 ${op.primaryColor}` : `Theme color → ${op.primaryColor}`);
        if (op.mode)
          lines.push(zh ? `外观改为${modeLabel[op.mode]}` : `Appearance → ${modeLabel[op.mode]}`);
        for (const [key, value] of Object.entries(op.colors ?? {})) {
          if (value === undefined) continue;
          const name = colorNames[key as keyof typeof colorNames];
          lines.push(
            value === null
              ? zh
                ? `${name}恢复默认`
                : `${name} → default`
              : zh
                ? `${name}改为 ${value}`
                : `${name} → ${value}`,
          );
        }
        for (const key of [
          'font',
          'fontScale',
          'radius',
          'density',
          'cardStyle',
          'navStyle',
        ] as const) {
          if (op[key] !== undefined) lines.push(describeToken(key, op[key], zh));
        }
        break;
      }
      case 'resetTheme':
        lines.push(
          zh
            ? '样式恢复为默认风格（颜色、字体、圆角、间距）'
            : 'Reset the style to the default (colors, fonts, corners, spacing)',
        );
        break;
      case 'setNavItems':
        lines.push(
          zh
            ? `导航栏改为：${navList(op.items)}（原来：${navList(before.shell.nav)}）`
            : `Navigation → ${navList(op.items)} (was: ${navList(before.shell.nav)})`,
        );
        break;
      case 'setFloatingItems':
        lines.push(
          op.items.length === 0
            ? zh
              ? '去掉所有浮动按钮'
              : 'Remove all floating buttons'
            : zh
              ? `浮动按钮改为：${navList(op.items)}`
              : `Floating buttons → ${navList(op.items)}`,
        );
        break;
      case 'setPageIcon':
        lines.push(
          zh
            ? `页面「${pageName(op.pageId)}」的图标${op.icon ? `改为 ${op.icon}` : '去掉'}`
            : `Page “${pageName(op.pageId)}” icon → ${op.icon ?? 'none'}`,
        );
        break;
      case 'addPage':
        lines.push(
          zh
            ? `新建页面「${op.page.title}」（${op.page.components.length} 个组件）`
            : `Add page “${op.page.title}” (${op.page.components.length} components)`,
        );
        break;
      case 'removePage':
        lines.push(
          zh
            ? `删除页面「${pageName(op.pageId)}」（文件不受影响）`
            : `Remove page “${pageName(op.pageId)}” (files are not affected)`,
        );
        break;
      case 'setPageTitle':
        lines.push(
          zh
            ? `页面「${pageName(op.pageId)}」改名为「${op.title}」`
            : `Rename page “${pageName(op.pageId)}” to “${op.title}”`,
        );
        break;
      case 'moveComponent':
        lines.push(
          zh
            ? `把${comp(op.pageId, op.componentId)}移到${where(op.pageId, op.parentId)}第 ${op.toIndex + 1} 位`
            : `Move ${comp(op.pageId, op.componentId)} to position ${op.toIndex + 1} in ${where(op.pageId, op.parentId)}`,
        );
        break;
      case 'setComponentProps': {
        const propNames: Record<string, Record<Locale, string>> = {
          title: { zh: '标题', en: 'title' },
          subtitle: { zh: '副标题', en: 'subtitle' },
          text: { zh: '文字', en: 'text' },
          label: { zh: '文字', en: 'label' },
          layout: { zh: '排列方式', en: 'layout' },
          columns: { zh: '列数', en: 'columns' },
          icon: { zh: '图标', en: 'icon' },
          target: { zh: '打开的页面', en: 'target' },
          variant: { zh: '样式', en: 'variant' },
        };
        const changes = Object.entries(op.props)
          .map(([k, v]) => {
            const name = propNames[k]?.[ctx.locale] ?? k;
            const value = typeof v === 'string' ? (zh ? `「${v}」` : `“${v}”`) : JSON.stringify(v);
            return zh ? `${name}改为${value}` : `${name} → ${value}`;
          })
          .join(zh ? '，' : ', ');
        lines.push(
          zh
            ? `修改${comp(op.pageId, op.componentId)}：${changes}`
            : `Update ${comp(op.pageId, op.componentId)}: ${changes}`,
        );
        break;
      }
      case 'setComponentStyle': {
        const names: Record<string, [string, string]> = {
          align: ['对齐', 'alignment'],
          tone: ['颜色', 'color'],
          size: ['大小', 'size'],
        };
        const values: Record<string, [string, string]> = {
          start: ['靠左', 'left'],
          center: ['居中', 'centered'],
          default: ['默认', 'default'],
          primary: ['主色', 'primary'],
          secondary: ['辅助色', 'secondary'],
          tertiary: ['第三色', 'tertiary'],
          muted: ['弱化', 'muted'],
          small: ['小', 'small'],
          medium: ['中', 'medium'],
          large: ['大', 'large'],
        };
        const i = zh ? 0 : 1;
        const changes = (Object.entries(op.style) as [string, string | null | undefined][])
          .filter((e): e is [string, string | null] => e[1] !== undefined)
          .map(([k, v]) => {
            const shown = v === null ? (zh ? '默认' : 'default') : (values[v]?.[i] ?? v);
            return zh ? `${names[k]![0]}改为${shown}` : `${names[k]![1]} → ${shown}`;
          })
          .join(zh ? '，' : ', ');
        lines.push(
          zh
            ? `调整${comp(op.pageId, op.componentId)}的外观：${changes}`
            : `Restyle ${comp(op.pageId, op.componentId)}: ${changes}`,
        );
        break;
      }
      case 'setComponentHidden':
        lines.push(
          zh
            ? `${op.hidden ? '隐藏' : '显示'}${comp(op.pageId, op.componentId)}`
            : `${op.hidden ? 'Hide' : 'Show'} ${comp(op.pageId, op.componentId)}`,
        );
        break;
      case 'addComponent':
        lines.push(
          zh
            ? `在${where(op.pageId, op.parentId)}添加${componentLabel(op.component, before, ctx)}`
            : `Add ${componentLabel(op.component, before, ctx)} to ${where(op.pageId, op.parentId)}`,
        );
        break;
      case 'removeComponent':
        lines.push(
          zh
            ? `从「${pageName(op.pageId)}」移除${comp(op.pageId, op.componentId)}`
            : `Remove ${comp(op.pageId, op.componentId)} from “${pageName(op.pageId)}”`,
        );
        break;
      case 'installTool':
        lines.push(
          zh
            ? `安装「${toolName(op.toolId)}」工具：新增工具页面和首页入口`
            : `Install the ${toolName(op.toolId)} tool: adds its page and a home card`,
        );
        break;
      case 'uninstallTool':
        lines.push(
          zh
            ? `卸载「${toolName(op.toolId)}」工具：移除入口、页面和流程，已有文件全部保留`
            : `Uninstall the ${toolName(op.toolId)} tool: removes its card, page and workflows; your files are kept`,
        );
        break;
      case 'setStepParams': {
        const name = wf(op.workflowId)?.name ?? op.workflowId;
        const template = op.params.nameTemplate ?? op.params.defaultTemplate;
        if (typeof template === 'string') {
          const example = `${renderNameTemplate(template, { now: ctx.now, sourceName: 'report' })}.pdf`;
          lines.push(
            zh
              ? `「${name}」的「${stepLabel(op.workflowId, op.stepId)}」命名规则改为 ${template}（例如 ${example}）`
              : `“${name}” – ${stepLabel(op.workflowId, op.stepId)}: file name → ${template} (e.g. ${example})`,
          );
        } else {
          lines.push(
            zh
              ? `调整「${name}」的「${stepLabel(op.workflowId, op.stepId)}」设置`
              : `Update “${name}” – ${stepLabel(op.workflowId, op.stepId)}`,
          );
        }
        break;
      }
      case 'removeWorkflowStep': {
        const name = wf(op.workflowId)?.name ?? op.workflowId;
        lines.push(
          zh
            ? `「${name}」去掉步骤「${stepLabel(op.workflowId, op.stepId)}」`
            : `Remove step “${stepLabel(op.workflowId, op.stepId)}” from “${name}”`,
        );
        break;
      }
    }
  }
  for (const note of notes) {
    if (note.kind === 'movedToFloating') {
      const label = navTargetLabel(note.target, before, ctx.locale);
      lines.push(
        zh
          ? `「${label}」不能移除（AI 修改和历史入口都在里面），已改为浮动按钮`
          : `“${label}” can’t be removed (it holds the AI and History entries), so it becomes a floating button`,
      );
    } else {
      lines.push(
        zh
          ? `同时移除 ${note.count} 个指向「${pageName(note.pageId)}」的按钮或快捷入口`
          : `Also removes ${note.count} button(s) or shortcut(s) that opened “${pageName(note.pageId)}”`,
      );
    }
  }
  return lines;
}

/** 恢复历史版本时的说明（§7E）：哪些会回到当时的样子、工具入口如何变化、文件不受影响。 */
export function describeRestore(
  before: WorkspaceConfig,
  after: WorkspaceConfig,
  revision: { id: number; summary: string },
  ctx: Pick<DescribeContext, 'registry' | 'locale'>,
): string[] {
  const zh = ctx.locale === 'zh';
  const toolName = (id: string) => ctx.registry.tools.get(id)?.name[ctx.locale] ?? id;
  const beforeTools = new Set(before.tools.map((t) => t.toolId));
  const afterTools = new Set(after.tools.map((t) => t.toolId));
  const lines = [
    zh
      ? `恢复到版本 #${revision.id}（${revision.summary}）：页面、导航、主题和工具流程回到当时的样子`
      : `Restore version #${revision.id} (${revision.summary}): pages, navigation, theme and tool workflows go back to how they were`,
  ];
  for (const id of beforeTools) {
    if (!afterTools.has(id)) {
      lines.push(
        zh
          ? `「${toolName(id)}」工具的入口和流程会被移除；它用过和生成的文件都会保留，重新安装即可继续使用`
          : `The ${toolName(id)} tool’s card and workflows will be removed; its files are kept and it can be reinstalled`,
      );
    }
  }
  for (const id of afterTools) {
    if (!beforeTools.has(id)) {
      lines.push(zh ? `「${toolName(id)}」工具会重新出现` : `The ${toolName(id)} tool comes back`);
    }
  }
  lines.push(zh ? '你的文件不受影响' : 'Your files are not affected');
  return lines;
}
