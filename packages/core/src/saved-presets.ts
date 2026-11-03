import { prepareSnapshot, type PreparedChange } from './change';
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
