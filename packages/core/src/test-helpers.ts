// 仅供测试使用的辅助函数（不从 index.ts 导出）。
import { applyOps, type Op } from './ops';
import { createRegistry } from './registry';
import { createDefaultWorkspace } from './defaults';
import type { Locale, WorkspaceConfig } from './schema';
import { BUILTIN_TOOLS } from './tools';

export const registry = createRegistry(BUILTIN_TOOLS);

export function apply(config: WorkspaceConfig, ops: Op[], locale: Locale = 'zh'): WorkspaceConfig {
  const result = applyOps(config, ops, { registry, locale });
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

export function workspace(locale: Locale = 'zh', { withPdf = false } = {}): WorkspaceConfig {
  const config = createDefaultWorkspace(locale);
  return withPdf ? apply(config, [{ op: 'installTool', toolId: 'pdf' }], locale) : config;
}
