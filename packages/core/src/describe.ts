import { SYSTEM_TARGET_LABELS } from './defaults';
import { renderNameTemplate } from './naming';
import type { ApplyNote, Op } from './ops';
import type { Registry } from './registry';
import {
  pageIdOf,
  type Component,
  type Locale,
  type NavTarget,
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
  }
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
  const comp = (pageId: string, id: string) => {
    const c = page(pageId)?.components.find((x) => x.id === id);
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

  const lines: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'setTheme':
        if (op.primaryColor)
          lines.push(zh ? `主题色改为 ${op.primaryColor}` : `Theme color → ${op.primaryColor}`);
        if (op.mode)
          lines.push(zh ? `外观改为${modeLabel[op.mode]}` : `Appearance → ${modeLabel[op.mode]}`);
        break;
      case 'setNavItems':
        lines.push(
          zh
            ? `导航栏改为：${navList(op.items)}（原来：${navList(before.shell.nav)}）`
            : `Navigation → ${navList(op.items)} (was: ${navList(before.shell.nav)})`,
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
            ? `把${comp(op.pageId, op.componentId)}移到「${pageName(op.pageId)}」第 ${op.toIndex + 1} 位`
            : `Move ${comp(op.pageId, op.componentId)} to position ${op.toIndex + 1} on “${pageName(op.pageId)}”`,
        );
        break;
      case 'setComponentProps': {
        const changes = Object.entries(op.props)
          .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
          .join(', ');
        lines.push(
          zh
            ? `修改${comp(op.pageId, op.componentId)}：${changes}`
            : `Update ${comp(op.pageId, op.componentId)}: ${changes}`,
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
            ? `在「${pageName(op.pageId)}」添加${componentLabel(op.component as Component, before, ctx)}`
            : `Add ${componentLabel(op.component as Component, before, ctx)} to “${pageName(op.pageId)}”`,
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
    const label = navTargetLabel(note.target, before, ctx.locale);
    lines.push(
      zh
        ? `「${label}」不能删除，已改为浮动按钮`
        : `“${label}” can’t be removed, so it becomes a floating button`,
    );
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
