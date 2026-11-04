import { isKnownComponent, type Component, type KnownComponent, type Page } from './schema';

// 页面的固定区（创始人 2026-11-04 定）：配置里还是一串 page.blocks，只在画的时候按 pin 分开（和右下角的浮动「+」一样）。

export type BrowseListBlock = Extract<KnownComponent, { look: 'list' | 'cards' | 'checklist' }>;

const isBrowseList = (c: Component): c is BrowseListBlock =>
  isKnownComponent(c) &&
  (c.look === 'list' || c.look === 'cards' || c.look === 'checklist') &&
  c.show.browse !== undefined;

/** 页面顶层有 show.browse 的列表（隐藏的也算：校验看配置，隐藏只影响显示）。分组里的不算。 */
export const pageBrowseLists = (page: Page): BrowseListBlock[] => page.blocks.filter(isBrowseList);

export const pageDial = (page: Page): Extract<KnownComponent, { look: 'dial' }> | undefined =>
  page.blocks.find(
    (c): c is Extract<KnownComponent, { look: 'dial' }> =>
      !c.hidden && isKnownComponent(c) && c.look === 'dial',
  );

/**
 * 状态要放在页面上的那个列表：搜索、排序、筛选要画在固定区（browse.pin），或者分开的浮动按钮要拿它选出的记录。
 * 隐藏的不算。其余的列表状态在自己的块里。
 */
export function pageBrowseHost(page: Page): BrowseListBlock | undefined {
  const visible = pageBrowseLists(page).filter((c) => !c.hidden);
  const handing = pageDial(page)?.tools.some((u) => u.as === 'list');
  return visible.find((c) => c.show.browse?.pin === true) ?? (handing ? visible[0] : undefined);
}

/** 页面分成上、中、下三段（隐藏的不画）。 */
export function pageZones(page: Page): {
  top: Component[];
  middle: Component[];
  bottom: Component[];
} {
  const shown = page.blocks.filter((c) => !c.hidden);
  const pinOf = (c: Component) => (isKnownComponent(c) ? c.pin : undefined);
  return {
    top: shown.filter((c) => pinOf(c) === 'top'),
    middle: shown.filter((c) => pinOf(c) === undefined),
    bottom: shown.filter((c) => pinOf(c) === 'bottom'),
  };
}
