import { CURRENT_SCHEMA_VERSION, type WorkspaceConfig } from './schema';

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
 * 配置文件最多多大：一个真实的 App 配置只有几十 KB，超过这个的不是配置文件，也不往内存里读。
 * 选文件时按字节数比，读出来的文字按字符数比（一个字符至少一个字节，所以不会比文件的限制更严）。
 */
export const MAX_APP_CONFIG_SIZE = 2_000_000;

/** 读不了的原因；调用的地方各自翻成用户看得懂的话（messages）。 */
export type AppConfigFileProblem =
  /** 太大。 */
  | 'tooLarge'
  /** 不是 JSON。 */
  | 'notJson'
  /** 是 JSON，但不是 App 配置文件（别的格式、缺 format / version / config）。 */
  | 'wrongFormat'
  /** 文件或里面的配置是更新的 Tinkrum 做的，这个版本读不了。 */
  | 'newerApp';

export type ParsedAppConfigFile =
  { ok: true; config: Record<string, unknown> } | { ok: false; problem: AppConfigFileProblem };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 读导入的 App 配置文件：导出的文件（format、version、config；门户下载的预设也是这个格式），
 * 或者直接是一份配置（有 schemaVersion）。只认文件的形状和版本；旧版本配置的迁移、校验和清文件引用
 * 由后面的 prepareSnapshot / preparePreset 做（底线 3、12、18）。
 */
export function parseAppConfigFile(text: string): ParsedAppConfigFile {
  if (text.length > MAX_APP_CONFIG_SIZE) return { ok: false, problem: 'tooLarge' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'notJson' };
  }
  const wrongFormat = { ok: false, problem: 'wrongFormat' } as const;
  if (!isObject(data)) return wrongFormat;
  let config: unknown = data;
  if (data.format !== undefined) {
    if (data.format !== APP_CONFIG_FILE_FORMAT) return wrongFormat;
    const version = data.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
      return wrongFormat;
    if (version > FILE_VERSION) return { ok: false, problem: 'newerApp' };
    config = data.config;
  }
  if (!isObject(config) || !Number.isInteger(config.schemaVersion)) return wrongFormat;
  if ((config.schemaVersion as number) > CURRENT_SCHEMA_VERSION)
    return { ok: false, problem: 'newerApp' };
  return { ok: true, config };
}
