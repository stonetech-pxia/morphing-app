import type { Registry } from './registry';
import { referenceProblems } from './reference-checks';
import type { WorkspaceConfig } from './schema';
import { validateWorkspace } from './validate';

// app 里的 Tink 只能改这个 app（D-485，暂定规则）。检查的是「修改前后的配置」，不是逐个操作：
// 删页面、删数据、装工具包都会连带改别处，按操作的目标 ID 判断会漏。做法：
//   1. 这个 app 的东西（页面、表、快捷操作、nav.apps 里它自己那一项）剔掉以后，其余必须一字不差；
//   2. 这个 app 自己的东西只能指向它自己的，或主页的表（其他 app 的东西拿掉以后配置仍然自洽）。
// 修改里新加的、没写 app 的页面、表、快捷操作自动属于这个 app（模型常忘了写）。
// 只在修改时查，不放进 validateWorkspace：规则以后收紧，已存的旧版本也要能打开（底线 12）。

/** 这次修改新加的页面、表、快捷操作没写 app 的，归到这个 app。 */
export function tagNewForApp(before: WorkspaceConfig, after: WorkspaceConfig, appId: string): void {
  const had = {
    page: new Set(before.containers.pages.map((p) => p.id)),
    table: new Set(before.data.tables.map((t) => t.id)),
    tool: new Set(before.tools.map((t) => t.id)),
  };
  for (const page of after.containers.pages)
    if (!had.page.has(page.id) && page.app === undefined && !page.package) page.app = appId;
  for (const table of after.data.tables)
    if (!had.table.has(table.id) && table.app === undefined) table.app = appId;
  for (const tool of after.tools)
    if (
      tool.kind === 'quickAction' &&
      !had.tool.has(tool.id) &&
      tool.app === undefined &&
      !tool.package
    )
      tool.app = appId;
}

/** 剔掉这个 app 的东西。 */
function withoutApp(config: WorkspaceConfig, appId: string): unknown {
  const nav = { ...config.nav };
  if (nav.apps) {
    nav.apps = nav.apps.filter((a) => a.id !== appId);
    if (nav.apps.length === 0) delete nav.apps;
  }
  return {
    ...config,
    nav,
    containers: {
      ...config.containers,
      pages: config.containers.pages.filter((p) => p.app !== appId),
    },
    data: { ...config.data, tables: config.data.tables.filter((t) => t.app !== appId) },
    tools: config.tools.filter((t) => !(t.kind === 'quickAction' && t.app === appId)),
  };
}

/** 只留这个 app 和主页的东西（其他 app 的页面、表、快捷操作、app 本身拿掉）。 */
function onlyAppAndHome(config: WorkspaceConfig, appId: string): WorkspaceConfig {
  const mine = (owner: string | undefined) => owner === undefined || owner === appId;
  const nav = { ...config.nav };
  if (nav.apps) nav.apps = nav.apps.filter((a) => a.id === appId);
  return {
    ...config,
    nav,
    containers: {
      ...config.containers,
      pages: config.containers.pages.filter((p) => mine(p.app)),
    },
    data: { ...config.data, tables: config.data.tables.filter((t) => mine(t.app)) },
    tools: config.tools.filter((t) => t.kind !== 'quickAction' || mine(t.app)),
  };
}

const problemsOf = (config: WorkspaceConfig, registry: Registry): string[] => {
  const valid = validateWorkspace(config, registry, { unknownComponents: 'keep' });
  return [
    ...(valid.ok ? [] : valid.issues.map((i) => i.message)),
    ...referenceProblems(config, registry),
  ];
};

/** 超出范围的地方（没有时是空的）。每一条都是模型能照着改的话。 */
export function scopeProblems(
  before: WorkspaceConfig,
  after: WorkspaceConfig,
  appId: string,
  registry: Registry,
): string[] {
  const problems: string[] = [];
  if (!after.nav.apps?.some((a) => a.id === appId))
    problems.push(`app ${appId} cannot be removed from inside the app`);
  if (JSON.stringify(withoutApp(before, appId)) !== JSON.stringify(withoutApp(after, appId)))
    problems.push(
      `out of scope: inside app ${appId} you can only change this app's own pages, tables, quick actions, bar and style; the home page, other apps, the home bar, tools, reminders and the file room are not yours to change`,
    );
  const old = new Set(problemsOf(onlyAppAndHome(before, appId), registry));
  const added = problemsOf(onlyAppAndHome(after, appId), registry).filter((p) => !old.has(p));
  for (const p of added)
    problems.push(
      `out of scope: ${p} (inside an app you can only point at its own things or the home page's tables)`,
    );
  return problems;
}

/**
 * 发给模型的配置（在 app 里改时）：只有这个 app 的页面、表、快捷操作，加上主页的表（只能指向，不能改）；
 * 主页的页面、主页底栏、别的 app 看不到。模型改的还是完整配置（ops 在完整配置上执行并检查范围）。
 */
export function scopedViewForAI(config: WorkspaceConfig, appId: string): WorkspaceConfig {
  const mineOrHome = (owner: string | undefined) => owner === undefined || owner === appId;
  const app = config.nav.apps?.find((a) => a.id === appId);
  return {
    ...config,
    nav: { bar: app?.bar ?? [], floating: [], ...(app ? { apps: [app] } : {}) } as never,
    containers: {
      ...config.containers,
      pages: config.containers.pages.filter((p) => p.app === appId),
    },
    data: { ...config.data, tables: config.data.tables.filter((t) => mineOrHome(t.app)) },
    tools: config.tools.filter((t) => t.kind === 'quickAction' && t.app === appId),
  };
}

/** 看不到的东西占着的 ID（只有 ID，没有内容）：新东西不能重名。 */
export function hiddenIdsForAI(
  config: WorkspaceConfig,
  appId: string,
): { pages: string[]; tables: string[]; tools: string[]; apps: string[] } {
  return {
    pages: config.containers.pages.filter((p) => p.app !== appId).map((p) => p.id),
    tables: config.data.tables
      .filter((t) => t.app !== undefined && t.app !== appId)
      .map((t) => t.id),
    tools: config.tools
      .filter((t) => !(t.kind === 'quickAction' && t.app === appId))
      .map((t) => t.id),
    apps: (config.nav.apps ?? []).filter((a) => a.id !== appId).map((a) => a.id),
  };
}
