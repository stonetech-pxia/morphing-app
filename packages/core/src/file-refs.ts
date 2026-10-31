import { allComponents, childrenOf, type Component, type WorkspaceConfig } from './schema';

// 底线 3（创始人 2026-10-31，对话）：配置里指向用户文件的地方只能由用户自己选。v34 只有四处
// （NEW_FORMAT §3.5）：文件位的 opens.file、图片块的 show.asset、卡片的 style.backdrop.assetId、页面的
// backdrop.assetId。发给 AI 时文件 ID 换成占位符；AI 的修改不能让任何一处多指向一个文件。

/** 发给 AI 的配置里，用户文件的 ID 换成这个。 */
export const REDACTED_FILE = '<user file>';

const FILE_KEYS = new Set(['assetId', 'asset', 'file']);

interface FileRef {
  /** 哪一处：块 ID（不分页面，移动块不算新引用）或页面，加上块里的路径。 */
  place: string;
  id: string;
  holder: Record<string, unknown>;
  key: string;
}

function refsIn(value: unknown, place: string, path: string, into: FileRef[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => refsIn(v, place, `${path}.${i}`, into));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FILE_KEYS.has(k) && typeof v === 'string')
        into.push({
          place: `${place}${path}.${k}`,
          id: v,
          holder: value as Record<string, unknown>,
          key: k,
        });
      else refsIn(v, place, `${path}.${k}`, into);
    }
  }
}

/** 配置里每一处文件引用（分组的子块单独算，不算在分组上）。 */
function fileRefs(config: WorkspaceConfig): FileRef[] {
  const out: FileRef[] = [];
  for (const page of config.containers.pages) {
    if (page.backdrop) refsIn(page.backdrop, `page:${page.id}`, '.backdrop', out);
    for (const c of allComponents(page)) {
      const own: Component = childrenOf(c).length > 0 ? ({ ...c, children: [] } as Component) : c;
      refsIn(own, `block:${c.id}`, '', out);
    }
  }
  return out;
}

/** 发给 AI 前：文件 ID 换成占位符（AI 只知道这里放了一个用户的文件）。 */
export function redactFileRefs(config: WorkspaceConfig): WorkspaceConfig {
  if (fileRefs(config).length === 0) return config;
  const copy = JSON.parse(JSON.stringify(config)) as WorkspaceConfig;
  for (const ref of fileRefs(copy)) ref.holder[ref.key] = REDACTED_FILE;
  return copy;
}

/**
 * AI 把占位符原样写回来时（例如整块重写 opens），换回修改前同一处的文件 ID。同一处原来没有文件、
 * 或有不止一个，就留着占位符（后面的检查会拒绝）。
 */
export function restoreFileRefs(before: WorkspaceConfig, after: WorkspaceConfig): WorkspaceConfig {
  if (!fileRefs(after).some((r) => r.id === REDACTED_FILE)) return after;
  const old = new Map<string, Set<string>>();
  for (const r of fileRefs(before)) old.set(r.place, (old.get(r.place) ?? new Set()).add(r.id));
  const copy = JSON.parse(JSON.stringify(after)) as WorkspaceConfig;
  for (const ref of fileRefs(copy)) {
    const ids = old.get(ref.place);
    if (ref.id === REDACTED_FILE && ids?.size === 1) ref.holder[ref.key] = [...ids][0];
  }
  return copy;
}

/**
 * 修改后比修改前多出来的文件引用（哪一处）。清空、移除、移动、改别的属性都不算；
 * 新加的、换成另一个文件的、复制出来的都算。
 */
export function newFileRefs(before: WorkspaceConfig, after: WorkspaceConfig): string[] {
  const count = new Map<string, number>();
  for (const r of fileRefs(before)) {
    const key = `${r.place}=${r.id}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const added: string[] = [];
  for (const r of fileRefs(after)) {
    const key = `${r.place}=${r.id}`;
    const left = count.get(key) ?? 0;
    if (left > 0) count.set(key, left - 1);
    else added.push(r.place.replace(/^(block|page):/, ''));
  }
  return added;
}
