import { t, pairText } from './messages';
import { createDefaultWorkspace } from './defaults';
import { applyOps } from './ops';
import type { Op } from './ops-schema';
import type { Registry } from './registry';
import {
  HOME_PAGE_ID,
  TOOLBOX_PAGE_ID,
  allComponents,
  isKnownComponent,
  pageTarget,
  type ComponentOf,
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
 * 「打开相册」「打开文件」两个入口并排放在首页（新手引导第 1 步和「跳过引导」用，D-231）；
 * 首页已经有文件入口时不再加。
 */
export function homeFileEntryOps(config: WorkspaceConfig): Op[] {
  const home = config.containers.pages.find((p) => p.id === HOME_PAGE_ID);
  if (!home || allComponents(home).some((c) => isKnownComponent(c) && c.look === 'picker'))
    return [];
  const ids = new Set(allComponents(home).map((c) => c.id));
  const free = (id: string) => (ids.has(id) ? `${id}-2` : id);
  return [
    {
      op: 'addContainer',
      page: HOME_PAGE_ID,
      block: {
        id: free('file-entries'),
        look: 'group',
        show: { layout: 'grid', columns: 2 },
        children: [
          { id: free('open-media'), look: 'picker', tools: [{ tool: '$pick.media' }] },
          { id: free('open-files'), look: 'picker', tools: [{ tool: '$pick.files' }] },
        ],
      },
    },
  ];
}

/**
 * 新用户的第一个版本（D-182）：空白首页（D-231，引导第 1 步加上文件入口）、工具箱页面、预装工具，
 * 导航栏只有首页、AI、设置（工具在首页的工具箱里，管理工具和历史在设置里）。
 * createDefaultWorkspace 保持空白：测试、评测和回退都以它为基准。
 */
export function createStarterWorkspace(locale: Locale, registry: Registry): WorkspaceConfig {
  const pick = (pair: [string, string]) => pairText(locale, pair);
  const base = createDefaultWorkspace(locale);
  const toolIds = STARTER_TOOL_IDS.filter((id) => registry.tools.has(id));

  const grids: ComponentOf<'packages'>[] = TOOLBOX_GROUPS.flatMap((g) => {
    const ids = g.toolIds?.filter((id) => registry.tools.has(id));
    if (ids && ids.length === 0) return [];
    return [
      {
        id: `tools-${g.id}`,
        look: 'packages' as const,
        show: { title: pick(g.title) },
        source: { catalog: 'packages' as const, ...(ids ? { ids } : {}) },
      },
    ];
  });
  const toolbox = {
    id: TOOLBOX_PAGE_ID,
    title: t(locale, 'starter_Toolbox_802f3'),
    icon: 'apps' as const,
    blocks: [
      {
        id: 'toolbox-header',
        look: 'header' as const,
        show: { title: t(locale, 'starter_Toolbox_802f3') },
      },
      ...grids,
      {
        id: 'toolbox-manage',
        look: 'button' as const,
        show: { label: t(locale, 'starter_Manage_tools_f1487'), variant: 'text' as const },
        opens: 'tools' as const,
      },
    ],
  };

  const ops: Op[] = [
    // 先放工具箱：添加工具包时它已经显示这些工具包，首页就不会多出入口（D-181）。
    { op: 'addContainer', page: toolbox },
    ...toolIds.map((id) => ({ op: 'setPackage' as const, package: id, do: 'add' as const })),
    // 首页从空白开始（D-231）：新手引导第 1 步让用户自己加上「打开相册」「打开文件」。
    { op: 'removeContainer', page: HOME_PAGE_ID, block: 'welcome' },
    { op: 'removeContainer', page: HOME_PAGE_ID, block: 'catalog' },
    { op: 'removeContainer', page: HOME_PAGE_ID, block: 'recent-files' },
    { op: 'updateContainer', nav: { bar: [pageTarget(HOME_PAGE_ID), 'ai', 'settings'] } },
  ];
  const applied = applyOps(base, ops, { registry, locale });
  if (!applied.ok) return base;
  const valid = validateWorkspace(applied.config, registry);
  return valid.ok ? valid.config : base;
}
