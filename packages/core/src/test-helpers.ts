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

/**
 * 快照用的紧凑写法：一项一行（「路径 = JSON」），比展开的对象小得多，差异也好读。
 * 太长的对象和数组再往下拆一层；undefined 写成 "∅undefined"。
 */
export function snapshotLines(value: unknown, width = 100): string {
  const out: string[] = [];
  const json = (v: unknown) =>
    JSON.stringify(v, (_k, x: unknown) => (x === undefined ? '∅undefined' : x)) ?? '∅undefined';
  const walk = (v: unknown, path: string) => {
    const text = json(v);
    if (v !== null && typeof v === 'object' && text.length > width && Object.keys(v).length > 0) {
      for (const [k, x] of Object.entries(v))
        walk(x, Array.isArray(v) ? `${path}[${k}]` : path ? `${path}.${k}` : k);
    } else out.push(`${path} = ${text}`);
  };
  walk(value, '');
  return `\n${out.join('\n')}\n`;
}
