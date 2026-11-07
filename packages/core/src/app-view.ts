import type { WorkspaceConfig } from './schema';
import { pageIdOf, type AppBarTarget, type NavTarget, type Theme } from './schema-base';

// 当前 app 的视图（D-485）：主页是顶层的 nav.bar + theme，其他 app 在 nav.apps。外壳、导航、主题都读这个，
// 不在别处判断「是不是主页」。appId 不存在（例如恢复到没有这个 app 的旧版本）时回落主页。

export interface ShellView {
  /** null = 主页。 */
  appId: string | null;
  /** 主页是 nav.bar；app 是它自己的底栏。 */
  bar: readonly NavTarget[];
  /** 只有主页有浮动入口。 */
  floating: readonly NavTarget[];
  theme: Theme;
  /** app 的名字；主页没有。 */
  name?: string;
}

export function appViewOf(config: WorkspaceConfig, appId: string | null): ShellView {
  const app = appId === null ? undefined : config.nav.apps?.find((a) => a.id === appId);
  if (!app)
    return { appId: null, bar: config.nav.bar, floating: config.nav.floating, theme: config.theme };
  return {
    appId: app.id,
    bar: app.bar as readonly AppBarTarget[],
    floating: [],
    theme: app.theme,
    name: app.name,
  };
}

/** 一个页面属于哪个 app；主页的页面是 null，页面不存在是 undefined。 */
export function appOfPage(config: WorkspaceConfig, pageId: string): string | null | undefined {
  const page = config.containers.pages.find((p) => p.id === pageId);
  return page ? (page.app ?? null) : undefined;
}

/** 一个导航目标属于哪个 app：页面看它的 app；系统入口不属于任何一个，是 undefined。 */
export function appOfTarget(config: WorkspaceConfig, target: NavTarget): string | null | undefined {
  const pageId = pageIdOf(target);
  return pageId === null ? undefined : appOfPage(config, pageId);
}

/** 进入一个 app 后先显示哪一项：底栏里第一个不是 Tink 的；主页同 firstTab。 */
export function firstTarget(view: ShellView): NavTarget {
  const first = view.bar.find((n) => n !== 'ai');
  if (first !== undefined) return first;
  // 新 app 还没有页面，底栏里只有 Tink：没有页面可显示（外壳显示空状态）。
  if (view.appId !== null) return 'ai';
  return view.floating.find((n) => n !== 'ai') ?? 'settings';
}
