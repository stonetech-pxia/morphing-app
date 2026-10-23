import { createDefaultWorkspace } from './defaults';
import { applyOps } from './ops';
import type { Registry } from './registry';
import { HOME_PAGE_ID, pageTarget, type Locale, type WorkspaceConfig } from './schema';
import { validateWorkspace } from './validate';

/**
 * 新用户第一次打开时预装的工具（D-104）：需求量最大的图片和 PDF，「视频太大发不出去」的视频（D-146），
 * 加上手机本来就有的扫描、文字识别和二维码。都在本机运行，装上不会下载任何东西。
 */
export const STARTER_TOOL_IDS = ['image', 'pdf', 'video', 'scan', 'ocr', 'qr'] as const;

/**
 * 新用户的第一个版本：默认工作空间 + 预装工具，导航栏只有首页、工具、AI、设置（历史在设置里）。
 * createDefaultWorkspace 保持空白：测试、评测和回退都以它为基准。
 */
export function createStarterWorkspace(locale: Locale, registry: Registry): WorkspaceConfig {
  const base = createDefaultWorkspace(locale);
  const toolIds = STARTER_TOOL_IDS.filter((id) => registry.tools.has(id));
  const applied = applyOps(
    base,
    [
      ...toolIds.map((toolId) => ({ op: 'installTool' as const, toolId })),
      { op: 'setNavItems', items: [pageTarget(HOME_PAGE_ID), 'tools', 'ai', 'settings'] },
    ],
    { registry, locale },
  );
  if (!applied.ok) return base;
  const valid = validateWorkspace(applied.config, registry);
  return valid.ok ? valid.config : base;
}
