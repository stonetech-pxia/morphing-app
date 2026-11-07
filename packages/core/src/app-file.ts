import { homeScreenOp } from './home-screen';
import { applyOps, type Op } from './ops';
import { migrateWorkspace } from './migrate';
import type { Registry } from './registry';
import {
  CURRENT_SCHEMA_VERSION,
  HOME_PAGE_ID,
  type Collection,
  type Page,
  type Tool,
  type WorkspaceConfig,
} from './schema';
import type { AppBarTarget, IconValue, Theme } from './schema-base';
import { MAX_OPS_PER_CHANGE } from './ops-schema';

// App 文件（D-485）：一个 App 的全部内容（页面、表、快捷操作、提醒、风格），导入时加到现有的工作区里，
// 不替换任何东西。和「App 配置」（整份工作区，D-484）不同：这里的 ID 已经带了 App 自己的前缀，不会和别的
// App 撞；不含记录、用户文件、工具包、桌面菜单、日历这类整个工作区才有的设置。
// 旧版本的文件靠 schemaVersion 迁移（借整份配置的迁移，底线 12）；导入走 addContainer / addData / addTool 这些
// 普通操作：先预览，用户确认才生效，改动记录里能撤销（底线 7、18）。

export const APP_FILE_FORMAT = 'tinkrum-app';
const FILE_VERSION = 1;

export interface AppFile {
  format: typeof APP_FILE_FORMAT;
  version: 1;
  exportedAt: string;
  schemaVersion: number;
  app: { id: string; name: string; icon?: IconValue; bar: AppBarTarget[]; theme: Theme };
  pages: Page[];
  tables: Collection[];
  tools: Tool[];
}

export function appFileText(file: Omit<AppFile, 'format' | 'version' | 'exportedAt'>, now: Date) {
  return JSON.stringify(
    { format: APP_FILE_FORMAT, version: FILE_VERSION, exportedAt: now.toISOString(), ...file },
    null,
    2,
  );
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 借整份配置的外壳（只有 App 的这几样），走一遍迁移，再拆开。 */
function wrap(file: AppFile): Record<string, unknown> {
  return {
    schemaVersion: file.schemaVersion,
    theme: file.app.theme,
    nav: { bar: ['page:home'], floating: [] },
    data: { tables: file.tables },
    containers: { pages: file.pages },
    tools: file.tools,
    packages: [],
  };
}

/**
 * 读 App 文件：形状不对返回 null；旧版本迁移到当前版本。只认形状，内容合不合法由导入时的校验管（底线 12、18）。
 */
export function readAppFile(text: string): AppFile | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(data) || data.format !== APP_FILE_FORMAT) return null;
  const { app, pages, tables, tools, schemaVersion } = data;
  if (
    !isObject(app) ||
    typeof app.id !== 'string' ||
    typeof app.name !== 'string' ||
    !Array.isArray(app.bar) ||
    !isObject(app.theme) ||
    !Array.isArray(pages) ||
    !Array.isArray(tables) ||
    !Array.isArray(tools) ||
    !Number.isInteger(schemaVersion)
  )
    return null;
  const file = data as unknown as AppFile;
  if (file.schemaVersion === CURRENT_SCHEMA_VERSION) return file;
  const migrated = migrateWorkspace(wrap(file));
  if (!migrated.ok) return null;
  const m = migrated.config as unknown as WorkspaceConfig;
  return {
    ...file,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    app: { ...file.app, theme: m.theme },
    pages: m.containers.pages,
    tables: m.data.tables,
    tools: m.tools,
  };
}

export type AppImport = { ok: true; ops: Op[]; name: string } | { ok: false; error: string };

/** 怎么导入（D-485）：做成一个新 App（主页多一个入口），或者导入主页（换主页风格，页面加进导航栏）。 */
export type ImportMode = 'app' | 'home';

/**
 * 导入一个 App 文件的操作。表的 ID 已经在、并且在主页手里（例如之前删过这个 App，表转给了主页）：
 * 接回来，缺的字段补上，记录不动（底线 5）；页面、快捷操作、提醒、App 的 ID 重名，或表属于别的 App 时拒绝。
 */
export function appFileOps(
  file: AppFile,
  config: WorkspaceConfig,
  options: { mode?: ImportMode } = {},
): AppImport {
  const mode = options.mode ?? 'app';
  const id = file.app.id;
  const existingTable = new Map(config.data.tables.map((t) => [t.id, t]));
  const taken = (what: string, ids: string[], have: Set<string>) => {
    const clash = ids.filter((x) => have.has(x));
    return clash.length > 0 ? `${what} ${clash.join(', ')} already exist` : null;
  };
  const clash =
    (mode === 'app'
      ? taken('app', [id], new Set((config.nav.apps ?? []).map((a) => a.id)))
      : null) ??
    taken(
      'page',
      file.pages.map((p) => p.id),
      new Set(config.containers.pages.map((p) => p.id)),
    ) ??
    taken(
      'table',
      file.tables.filter((t) => existingTable.get(t.id)?.app !== undefined).map((t) => t.id),
      new Set(config.data.tables.map((t) => t.id)),
    ) ??
    taken(
      'quick action or reminder',
      file.tools.map((t) => t.id),
      new Set(config.tools.map((t) => t.id)),
    );
  if (clash) return { ok: false, error: clash };
  const owner = mode === 'app' ? { app: id } : {};
  const ops: Op[] = [];
  if (mode === 'app')
    ops.push({
      op: 'addContainer',
      app: {
        id,
        name: file.app.name,
        ...(file.app.icon !== undefined ? { icon: file.app.icon } : {}),
        bar: file.app.bar,
        theme: file.app.theme,
      },
    });
  for (const table of file.tables) {
    const have = existingTable.get(table.id);
    if (!have) {
      ops.push({ op: 'addData', table: { ...table, ...owner } as never });
      continue;
    }
    // 接回来：属于这个 App，缺的字段补上，已有的不改。
    if (mode === 'app')
      ops.push({ op: 'updateData', table: table.id, changes: { app: id } } as never);
    const fields = new Set(have.fields.map((f) => f.id));
    for (const field of table.fields)
      if (!fields.has(field.id)) ops.push({ op: 'addData', table: table.id, field } as never);
  }
  for (const tool of file.tools) ops.push({ op: 'addTool', tool: { ...tool, ...owner } as never });
  for (const page of file.pages)
    ops.push({ op: 'addContainer', page: { ...page, ...owner } as never });
  if (mode === 'app') {
    // 主页上放一个入口（用户随时能删；设置 → 我的 App 照样进得去）。
    if (config.containers.pages.some((p) => p.id === HOME_PAGE_ID))
      ops.push({
        op: 'addContainer',
        page: HOME_PAGE_ID,
        block: { id: `go-${id}`.slice(0, 48), look: 'entry', opens: `app:${id}` },
      } as unknown as Op);
  } else {
    // 导入主页：换成它的风格，它的页面加进主页的导航栏（放得下的）；放不下的由主页上的入口接住。
    ops.push({ op: 'setTheme', reset: true });
    ops.push({ op: 'setTheme', ...file.app.theme } as unknown as Op);
    const wanted = file.app.bar.filter((t) => t.startsWith('page:'));
    const bar = [...config.nav.bar];
    const room = 5 - bar.length;
    if (room > 0 && wanted.length > 0) {
      const at = bar.findIndex((t) => t === 'ai' || t === 'settings');
      bar.splice(at < 0 ? bar.length : at, 0, ...wanted.slice(0, room));
      ops.push({ op: 'updateContainer', nav: { bar } });
    }
  }
  if (ops.length > MAX_OPS_PER_CHANGE)
    return { ok: false, error: `too big to import in one go (${ops.length} steps)` };
  return { ok: true, ops, name: file.app.name };
}

/**
 * 恢复这个 App 的初始样子（D-485）：把现在的 App 删掉（页面、快捷操作、提醒、入口一起去掉，表和记录转给主页，
 * 底线 5），再用原来的 App 文件装回来：表接回来、缺的字段补上，用户自己建的表留在主页。
 * 在桌面菜单里的还放回去。能在改动记录里撤销。
 */
export function appResetOps(file: AppFile, config: WorkspaceConfig, registry: Registry): AppImport {
  const id = file.app.id;
  if (!(config.nav.apps ?? []).some((a) => a.id === id))
    return { ok: false, error: `app ${id} is not installed` };
  const removal: Op = { op: 'removeContainer', app: id };
  const mid = applyOps(config, [removal], { registry, locale: 'en' });
  if (!mid.ok) return { ok: false, error: mid.error };
  const plan = appFileOps(file, mid.config);
  if (!plan.ok) return plan;
  const onMenu = (config.nav.phoneHomeScreen ?? []).includes(`app:${id}`);
  const ops: Op[] = [
    removal,
    ...plan.ops,
    ...(onMenu ? [homeScreenOp(mid.config, `app:${id}`, true)] : []),
  ];
  if (ops.length > MAX_OPS_PER_CHANGE)
    return { ok: false, error: `too big to restore in one go (${ops.length} steps)` };
  return { ok: true, ops, name: file.app.name };
}

// ---- 整份配置 → App 文件（做预设用）----

/**
 * 引用 ID 的位置（和数据表、页面、快捷操作的结构对应）：只改这些位置，别的（字段 ID、块 ID、文案）不动。
 * 漏改的位置会让引用指向不存在的东西，校验器会报出来，所以转换后一定要校验。
 */
function rename(
  node: unknown,
  key: string | null,
  map: { pages: Map<string, string>; tables: Map<string, string>; tools: Map<string, string> },
): unknown {
  if (Array.isArray(node)) return node.map((x) => rename(x, key, map));
  if (isObject(node)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = rename(v, k, map);
    return out;
  }
  if (typeof node !== 'string') return node;
  if (key === 'table' || key === 'collectionId' || key === 'of')
    return map.tables.get(node) ?? node;
  if (key === 'tool') return map.tools.get(node) ?? node;
  if (key === 'opens') {
    if (node.startsWith('page:')) return `page:${map.pages.get(node.slice(5)) ?? node.slice(5)}`;
    if (node.startsWith('tool:')) return `tool:${map.tools.get(node.slice(5)) ?? node.slice(5)}`;
    // 记录块的 opens 是给一条记录用的页面（D-342）。
    return map.pages.get(node) ?? node;
  }
  return node;
}

export interface ConvertMeta {
  /** App 的 ID，也是所有页面、表、快捷操作 ID 的前缀（≤ 20 个字符）。 */
  id: string;
  name: string;
  icon?: IconValue;
}

/**
 * 把一份整份工作区的配置做成一个 App 文件：ID 加前缀并改好引用，主页变成 App 的第一页，底栏只留页面和 Tink。
 * 工具包、桌面菜单、浮动入口、文件桌面、日历是整个工作区的设置，不带。
 */
export function appFileFromWorkspace(
  config: WorkspaceConfig,
  meta: ConvertMeta,
): Omit<AppFile, 'format' | 'version' | 'exportedAt'> {
  const prefixed = (id: string) => `${meta.id}-${id}`;
  const pages = config.containers.pages.filter((p) => p.package === undefined);
  const map = {
    pages: new Map(pages.map((p) => [p.id, prefixed(p.id)])),
    tables: new Map(config.data.tables.map((t) => [t.id, prefixed(t.id)])),
    tools: new Map(
      config.tools.filter((t) => t.package === undefined).map((t) => [t.id, prefixed(t.id)]),
    ),
  };
  const withId = <T extends { id: string }>(item: T, to: Map<string, string>) => ({
    ...(rename(item, null, map) as T),
    id: to.get(item.id)!,
  });
  const bar = config.nav.bar.flatMap((target): AppBarTarget[] => {
    if (target === 'ai') return ['ai'];
    if (target.startsWith('page:')) {
      const id = map.pages.get(target.slice(5));
      return id ? [`page:${id}`] : [];
    }
    return [];
  });
  if (!bar.includes('ai') && bar.length < 5) bar.push('ai');
  const strip = <T extends { app?: string | undefined }>(item: T): T => {
    const { app: _app, ...rest } = item;
    return rest as T;
  };
  return {
    schemaVersion: config.schemaVersion,
    app: {
      id: meta.id,
      name: meta.name,
      ...(meta.icon !== undefined ? { icon: meta.icon } : {}),
      bar,
      theme: config.theme,
    },
    pages: pages.map((p) => strip(withId(p, map.pages))),
    tables: config.data.tables.map((t) => strip(withId(t, map.tables))),
    tools: config.tools
      .filter((t) => t.package === undefined)
      .map((t) => strip(withId(t, map.tools))),
  };
}
