import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import type { Op } from './ops';
import { allComponents, type WorkspaceConfig } from './schema';
import { apply, registry, workspace } from './test-helpers';

// 新页面的入口：AI 新加了一个页面却没有任何地方能打开它时，应用后用户找不到这一页
// （创始人 2026-10-31：让 AI 做 Todoist 的页面时经常忘了加入口）。在首页最后补一个入口，并在草稿说明里写出来。

const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 31) };
const newPage: Op = {
  op: 'addContainer',
  page: { id: 'tasks', title: '任务', icon: '✅', blocks: [] },
};

function prepare(config: WorkspaceConfig, ops: Op[]) {
  const result = prepareOps(config, ops, ctx);
  if (!result.ok) throw new Error(result.issues.join('; '));
  return result;
}
const homeEntries = (c: WorkspaceConfig) =>
  allComponents(c.containers.pages.find((p) => p.id === 'home')!).filter(
    (x) => x.look === 'entry' && (x as { opens?: unknown }).opens === 'page:tasks',
  );

describe('a new page nothing opens', () => {
  it('gets an entry at the end of the home page, and the draft says so', () => {
    const { after, lines } = prepare(workspace('zh'), [newPage]);
    const entries = homeEntries(after);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      look: 'entry',
      show: { title: '任务', icon: '✅' },
      opens: 'page:tasks',
    });
    const home = after.containers.pages.find((p) => p.id === 'home')!;
    expect(home.blocks.at(-1)).toBe(entries[0]);
    expect(lines.join('\n')).toContain('「任务」');
  });

  it('is left alone when the change already opens it from the bottom bar or a button', () => {
    const viaBar = prepare(workspace('zh'), [
      newPage,
      { op: 'updateContainer', nav: { bar: ['page:home', 'page:tasks', 'settings'] } } as Op,
    ]);
    expect(homeEntries(viaBar.after)).toEqual([]);

    const viaEntry = prepare(workspace('zh'), [
      newPage,
      {
        op: 'addContainer',
        page: 'home',
        block: {
          id: 'go-tasks',
          look: 'entry',
          show: { title: '去任务', icon: '✅' },
          opens: 'page:tasks',
        },
      } as Op,
    ]);
    expect(homeEntries(viaEntry.after).map((x) => x.id)).toEqual(['go-tasks']);
  });

  it('only looks at pages added in this change', () => {
    // 用户自己移除了入口：以后别的修改不再把它加回来。
    const withPage = prepare(workspace('zh'), [newPage]).after;
    const home = withPage.containers.pages.find((p) => p.id === 'home')!;
    const id = homeEntries(withPage)[0]!.id;
    const removed = apply(withPage, [{ op: 'removeContainer', page: home.id, block: id } as Op]);
    const later = prepare(removed, [{ op: 'setTheme', mode: 'dark' } as Op]);
    expect(homeEntries(later.after)).toEqual([]);
  });
});
