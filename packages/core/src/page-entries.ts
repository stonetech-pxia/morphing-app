import { componentRefs } from './components';
import {
  HOME_PAGE_ID,
  TOOLBOX_PAGE_ID,
  allComponents,
  pageTarget,
  remindersOf,
  type Component,
  type WorkspaceConfig,
} from './schema';

// 新页面的入口：AI 新加了一个页面，整个 App 里却没有任何地方能打开它（导航栏、浮动入口、别的页面上的按钮或
// 入口、提醒）时，应用后用户找不到这一页（创始人 2026-10-31：让 AI 做 Todoist 的页面时经常忘了加入口）。
// 这时在首页最后补一个入口（只在 AI 和用户的修改 prepareOps 里补，样例和模板照写的来）。只看这次新加的页面：用户以后自己移除了入口，别的修改不会再把它加回来。
// 工具包的页面（package）、给一条记录用的页面（of，从记录块打开）和工具箱（系统入口 tools 打开）不补。

/** 别的页面、导航和提醒里打开的所有目标。 */
function openedTargets(config: WorkspaceConfig, except: string): Set<unknown> {
  const targets = new Set<unknown>([...config.nav.bar, ...config.nav.floating]);
  for (const app of config.nav.apps ?? []) for (const t of app.bar) targets.add(t);
  for (const page of config.containers.pages) {
    if (page.id === except) continue;
    for (const c of allComponents(page)) for (const t of componentRefs(c, 'target')) targets.add(t);
  }
  for (const r of remindersOf(config)) targets.add(r.opens);
  return targets;
}

/** 给 after 里新加的、打不开的页面在首页补入口；返回补了入口的页面标题。 */
export function addMissingPageEntries(before: WorkspaceConfig, after: WorkspaceConfig): string[] {
  const home = after.containers.pages.find((p) => p.id === HOME_PAGE_ID);
  if (!home) return [];
  const added: string[] = [];
  for (const page of after.containers.pages) {
    if (page.id === HOME_PAGE_ID || page.id === TOOLBOX_PAGE_ID || page.package || page.of)
      continue;
    if (before.containers.pages.some((p) => p.id === page.id)) continue;
    const target = pageTarget(page.id);
    if (openedTargets(after, page.id).has(target)) continue;
    // app 里的页面：放进这个 app 的底栏（Tink 之前）；底栏满了，放在它第一页的最后（D-485）。
    const app = page.app !== undefined ? after.nav.apps?.find((a) => a.id === page.app) : undefined;
    if (page.app !== undefined) {
      if (!app) continue;
      if (app.bar.length < 5) {
        const at = app.bar.indexOf('ai');
        app.bar.splice(at < 0 ? app.bar.length : at, 0, target);
        added.push(page.title);
        continue;
      }
    }
    const holder = app
      ? after.containers.pages.find((p) => p.app === app.id && p.id !== page.id)
      : home;
    if (!holder) continue;
    const ids = new Set(after.containers.pages.flatMap((p) => allComponents(p).map((c) => c.id)));
    const stem = `open-${page.id}`.slice(0, 44);
    let id = stem;
    for (let n = 2; ids.has(id); n++) id = `${stem}-${n}`;
    holder.blocks.push({
      id,
      look: 'entry',
      show: { title: page.title.slice(0, 60), icon: page.icon ?? 'document' },
      opens: target,
    } as unknown as Component);
    added.push(page.title);
  }
  return added;
}
