import { prepareSnapshot, type PreparedChange } from './change';
import { parseAppConfigFile, type AppConfigFileProblem } from './config-file';
import { clearFileRefs } from './file-refs';
import type { Registry } from './registry';
import type { WorkspaceConfig } from './schema';

// 「设置 → 我的预设」（D-410）：把整个 App（表结构、页面、工具、风格）存成一份内核配置，以后换回来。
// 不带记录（记录本来就不在配置里，底线 14），也不带指向用户文件的引用（底线 3、18）。
// 预设存在本机数据库，不在 WorkspaceConfig 里：配置每次都发给云端 AI，预设不跟着发（底线 1、2）。

export const MAX_SAVED_PRESETS = 50;
export const MAX_PRESET_NAME = 40;

export const canSavePreset = (count: number): boolean => count < MAX_SAVED_PRESETS;

/** 用户输入的名字整理后的样子；空的返回 null。按字符截断，不会切开 emoji。 */
export function presetName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  return name ? Array.from(name).slice(0, MAX_PRESET_NAME).join('') : null;
}

/** 保存：当前配置的一份副本，文件引用都清掉。 */
export const presetSnapshot = (config: WorkspaceConfig): WorkspaceConfig => clearFileRefs(config);

/** 应用：存着的可能是旧版本的预设，先迁移、校验（底线 12），再清一次文件引用。 */
export function preparePreset(raw: unknown, registry: Registry): PreparedChange {
  const prepared = prepareSnapshot(raw, registry);
  return prepared.ok ? { ...prepared, after: clearFileRefs(prepared.after) } : prepared;
}

/**
 * 导入文件时给预设起的名字：文件名去掉扩展名，整理、截到 40 个字符；空的用 fallback；
 * 和已有的重名（不分大小写）就在后面加序号「名字 2」，加了序号也不超过 40 个字符。
 */
export function importedPresetName(
  fileName: string,
  existing: readonly string[],
  fallback: string,
): string {
  const base = presetName(fileName.replace(/\.[^./\\]*$/, '')) ?? presetName(fallback) ?? fallback;
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const room = MAX_PRESET_NAME - Array.from(suffix).length;
    const name = `${Array.from(base).slice(0, room).join('')}${suffix}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

export type ImportedPreset =
  | { ok: true; name: string; config: WorkspaceConfig }
  /** 文件本身读不了。 */
  | { ok: false; problem: AppConfigFileProblem }
  /** 是 App 配置文件，但迁移或校验没过：issues 是具体原因（底线 18）。 */
  | { ok: false; problem: 'invalid'; issues: string[] };

/**
 * 「我的预设 → 从文件导入」（门户下载的预设就是这样装进来的）：读文件、迁移到当前版本、校验、
 * 清掉文件引用（底线 3、12、18）。通过了返回要存的名字和配置；这里什么都不改，存进预设列表是调用的人的事，
 * 当前的 App 要等用户在列表里点「应用」才变。配置里本来就没有记录（底线 14）。
 */
export function importedPreset(
  text: string,
  fileName: string,
  existingNames: readonly string[],
  fallbackName: string,
  registry: Registry,
): ImportedPreset {
  const parsed = parseAppConfigFile(text);
  if (!parsed.ok) return parsed;
  const prepared = preparePreset(parsed.config, registry);
  if (!prepared.ok) return { ok: false, problem: 'invalid', issues: prepared.issues };
  return {
    ok: true,
    name: importedPresetName(fileName, existingNames, fallbackName),
    config: prepared.after,
  };
}
