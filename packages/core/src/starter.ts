import { createDefaultWorkspace } from './defaults';
import { applyOps, type Op } from './ops';
import type { Registry } from './registry';
import {
  HOME_PAGE_ID,
  TOOLBOX_PAGE_ID,
  pageTarget,
  type Component,
  type Locale,
  type WorkspaceConfig,
} from './schema';
import { validateWorkspace } from './validate';

/**
 * 新用户第一次打开时预装的工具（D-104）：需求量最大的图片和 PDF，「视频太大发不出去」的视频（D-146），
 * 加上手机本来就有的扫描、文字识别和二维码。都在本机运行，装上不会下载任何东西。
 */
export const STARTER_TOOL_IDS = ['image', 'pdf', 'video', 'scan', 'ocr', 'qr'] as const;

/** 工具箱的分组（D-181）：按用途分，最后一组接住没列出的工具（以后新加的工具也会出现在这里）。 */
const TOOLBOX_GROUPS: { id: string; title: [string, string]; toolIds?: string[] }[] = [
  {
    id: 'media',
    title: ['Photos, video and audio', '照片、视频和声音'],
    toolIds: ['image', 'video', 'audio'],
  },
  { id: 'files', title: ['Files and documents', '文件和材料'], toolIds: ['pdf', 'scan', 'zip'] },
  { id: 'text', title: ['Text', '文字'], toolIds: ['ocr', 'translate', 'text'] },
  // 二维码、报表和以后新加的工具。
  { id: 'more', title: ['More tools', '更多工具'] },
];

/**
 * 新用户的第一个版本（D-182）：精简首页（文件入口、功能分类和工具箱）、工具箱页面、预装工具，
 * 导航栏只有首页、AI、设置（工具在首页的工具箱里，管理工具和历史在设置里）。
 * createDefaultWorkspace 保持空白：测试、评测和回退都以它为基准。
 */
export function createStarterWorkspace(locale: Locale, registry: Registry): WorkspaceConfig {
  const zh = locale === 'zh';
  const pick = (pair: [string, string]) => (zh ? pair[1] : pair[0]);
  const base = createDefaultWorkspace(locale);
  const toolIds = STARTER_TOOL_IDS.filter((id) => registry.tools.has(id));

  const grids: Component[] = TOOLBOX_GROUPS.flatMap((g) => {
    const ids = g.toolIds?.filter((id) => registry.tools.has(id));
    if (ids && ids.length === 0) return [];
    return [
      {
        id: `tools-${g.id}`,
        type: 'toolGrid' as const,
        props: { title: pick(g.title), ...(ids ? { toolIds: ids } : {}) },
      },
    ];
  });
  const toolbox = {
    id: TOOLBOX_PAGE_ID,
    title: zh ? '工具箱' : 'Toolbox',
    icon: 'apps' as const,
    components: [
      {
        id: 'toolbox-header',
        type: 'header' as const,
        props: { title: zh ? '工具箱' : 'Toolbox' },
      },
      ...grids,
      {
        id: 'toolbox-manage',
        type: 'button' as const,
        props: {
          label: zh ? '管理工具' : 'Manage tools',
          target: 'tools' as const,
          variant: 'text' as const,
        },
      },
    ],
  };

  const ops: Op[] = [
    // 先放工具箱：添加工具时它已经显示这些工具，首页就不会多出工具入口（D-181）。
    { op: 'addPage', page: toolbox },
    ...toolIds.map((toolId) => ({ op: 'installTool' as const, toolId })),
    { op: 'removeComponent', pageId: HOME_PAGE_ID, componentId: 'catalog' },
    { op: 'removeComponent', pageId: HOME_PAGE_ID, componentId: 'recent-files' },
    {
      op: 'addComponent',
      pageId: HOME_PAGE_ID,
      component: {
        id: 'file-entries',
        type: 'group',
        props: { layout: 'grid', columns: 2 },
        children: [
          { id: 'open-media', type: 'filePick', props: { source: 'media' } },
          { id: 'open-files', type: 'filePick', props: { source: 'files' } },
        ],
      },
    },
    {
      op: 'addComponent',
      pageId: HOME_PAGE_ID,
      component: {
        id: 'what-morph-can-do',
        type: 'shortcut',
        props: {
          title: zh ? 'Morph 可以做什么' : 'What Morph can do',
          icon: 'workflow',
          target: 'quickActions',
        },
      },
    },
    {
      op: 'addComponent',
      pageId: HOME_PAGE_ID,
      component: {
        id: 'open-toolbox',
        type: 'shortcut',
        props: {
          title: zh ? '工具箱' : 'Toolbox',
          subtitle: zh ? '全部工具' : 'All tools',
          icon: 'apps',
          target: pageTarget(TOOLBOX_PAGE_ID),
        },
      },
    },
    { op: 'setNavItems', items: [pageTarget(HOME_PAGE_ID), 'ai', 'settings'] },
  ];
  const applied = applyOps(base, ops, { registry, locale });
  if (!applied.ok) return base;
  const valid = validateWorkspace(applied.config, registry);
  return valid.ok ? valid.config : base;
}
