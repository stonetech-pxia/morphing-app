import type { WorkspaceConfig } from './schema';

// 「设置 → 数据 → 导出 App 配置」：把 App 的设计（页面、数据表的结构、快捷操作、提醒、主题）存成一个文件。
// 不含记录、用户文件和预填记忆；配置里的照片只是随机文件 ID（D-046），文件本身不在里面。

export const APP_CONFIG_FILE_FORMAT = 'morph-app-config';
const FILE_VERSION = 1;

export function appConfigFile(config: WorkspaceConfig, now: Date): string {
  return JSON.stringify(
    {
      format: APP_CONFIG_FILE_FORMAT,
      version: FILE_VERSION,
      exportedAt: now.toISOString(),
      config,
    },
    null,
    2,
  );
}

/** 文件名带日期（本地时间），导出几次不会互相覆盖。 */
export function appConfigFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `tinkrum-config-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/**
 * 读导入的 App 配置文件：导出的文件（format、version、config），或者直接是一份配置（有 schemaVersion）。
 * 只认形状；旧版本的迁移和校验由应用时的 prepareSnapshot 做（底线 12、18）。不是这两种返回 null。
 */
export function readAppConfigFile(text: string): unknown {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObject(data)) return null;
  if (data.format === APP_CONFIG_FILE_FORMAT) {
    return isObject(data.config) && Number.isInteger(data.config.schemaVersion)
      ? data.config
      : null;
  }
  return Number.isInteger(data.schemaVersion) ? data : null;
}
