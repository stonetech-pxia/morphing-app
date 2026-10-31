import {
  FILE_RECORD_PRESETS,
  templateTableOf,
  templateTableName,
  type FileRecordPreset,
  type Locale,
  type WorkspaceConfig,
} from '@morph/core';

// 收件页面「存成记录」（D-386）：先列出有附件字段的表（全部，不推荐），再列预设表，最后是「空白」。
// 不用 AI、不识别文字、不预填别的值；收到的文件复制成用户文件放进附件字段，用户自己填完保存。

export type RecordChoice =
  | { kind: 'table'; tableId: string; name: string }
  | { kind: 'preset'; preset: FileRecordPreset; name: string };

export function recordChoices(config: WorkspaceConfig, locale: Locale): RecordChoice[] {
  const tables = config.data.tables
    .filter((c) => c.fields.some((f) => f.type === 'file'))
    .map((c): RecordChoice => ({ kind: 'table', tableId: c.id, name: c.name }));
  // 「空白」排在最后（FILE_RECORD_PRESETS 里它就在最后）；名字由界面写成「空白」。
  // 已经建过、表还在的预设不再列（它在上面的表里）；「空白」一直在，想要第二张同类的表用它。
  const presets = FILE_RECORD_PRESETS.filter(
    (preset) => preset === 'blank' || templateTableOf(preset, config) === undefined,
  ).map((preset): RecordChoice => ({
    kind: 'preset',
    preset,
    name: templateTableName(preset, locale),
  }));
  return [...tables, ...presets];
}

/**
 * 为新记录表单复制出来的用户文件（还没有存进任何记录）。只在内存里，按一个随机的键交给记录页：
 * 用户没保存就离开时，记录页按这个键删掉它们。不放进路由参数：外部链接不能借这个删用户的文件。
 */
const formCopies = new Map<string, string[]>();

export function holdFormCopies(assetIds: string[]): string {
  const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  formCopies.set(key, assetIds);
  return key;
}

/** 取走这个键的文件（只能取一次）；不是这里给的键返回空。 */
export function takeFormCopies(key: string | undefined): string[] {
  if (!key) return [];
  const ids = formCopies.get(key) ?? [];
  formCopies.delete(key);
  return ids;
}
