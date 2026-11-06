import { describe, expect, it } from 'vitest';

import { describeChange } from './describe';
import { applyOps } from './ops';
import {
  allComponents,
  isKnownComponent,
  quickActionsOf,
  toolGridToolIds,
  type ComponentOf,
} from './schema';
import { STARTER_TOOL_IDS, createStarterWorkspace, homeFileEntryOps } from './starter';
import { fromV33, registry, v33Fixture, withScanKeep } from './test-helpers';
import { validateWorkspace } from './validate';

const catalog = [...registry.tools.keys()];

describe('createStarterWorkspace', () => {
  it.each(['zh', 'en', 'fr'] as const)(
    'installs the starter tools, a three-item bar and an empty home page (%s)',
    (locale) => {
      const config = createStarterWorkspace(locale, registry);
      expect(validateWorkspace(config, registry).ok).toBe(true);
      expect(config.packages.map((t) => t.id)).toEqual([...STARTER_TOOL_IDS]);
      expect(config.nav.bar).toEqual(['page:home', 'ai', 'settings']);
      const home = config.containers.pages.find((p) => p.id === 'home')!;
      // 首页从空白开始，引导第 1 步加上文件入口（D-231）；不预装用户快捷操作。
      expect(home.blocks).toEqual([]);
      expect(quickActionsOf(config).filter((w) => !w.package)).toEqual([]);
    },
  );

  it.each(['zh', 'en'] as const)('is the v33 starter, migrated (%s)', (locale) => {
    expect(createStarterWorkspace(locale, registry)).toEqual(
      withScanKeep(fromV33(v33Fixture(`starter-${locale}`))),
    );
  });

  // D-449：首页的两个入口是只有图标的白底按钮：扫描（直接运行内设的「扫描成 PDF」）和打开文件（选相册或文件）。
  it('adds the scan and open-file icon buttons side by side once', () => {
    const config = createStarterWorkspace('zh', registry);
    const ops = homeFileEntryOps(config, 'zh');
    const result = applyOps(config, ops, { registry, locale: 'zh' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateWorkspace(result.config, registry).ok).toBe(true);
    const home = result.config.containers.pages.find((p) => p.id === 'home')!;
    expect(home.blocks[0]).toMatchObject({ look: 'group', show: { layout: 'grid', columns: 2 } });
    expect((home.blocks[0] as ComponentOf<'group'>).children).toMatchObject([
      { look: 'action', show: { shape: 'icon' }, tools: [{ tool: 'scan-camera' }] },
      { look: 'picker', show: { shape: 'icon' }, tools: [{ tool: '$pick.open' }] },
    ]);
    // D-452：下面是最近操作（读运行记录）和最近的 3 个文件。
    expect(home.blocks.slice(2)).toMatchObject([
      { look: 'library', show: { title: '最近操作' }, source: { recent: true } },
      { look: 'files', show: { title: '最近文件' }, source: { table: '$files', limit: 3 } },
    ]);
    expect(homeFileEntryOps(result.config, 'zh')).toEqual([]);
  });

  it('puts a Toolbox button right under the two buttons; it opens the toolbox page (icons grouped by category)', () => {
    const config = createStarterWorkspace('zh', registry);
    const result = applyOps(config, homeFileEntryOps(config, 'zh'), { registry, locale: 'zh' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateWorkspace(result.config, registry).ok).toBe(true);
    const home = result.config.containers.pages.find((p) => p.id === 'home')!;
    expect(home.blocks[1]).toMatchObject({
      look: 'button',
      show: { label: '工具箱', icon: 'apps' },
      opens: 'page:toolbox',
    });
    expect(home.blocks[2]).toMatchObject({ look: 'library' });
  });

  it('the old two pickers from v33 still load (photo library and files)', () => {
    const old = fromV33(v33Fixture('starter-files-zh'));
    expect(validateWorkspace(old, registry).ok).toBe(true);
    expect(homeFileEntryOps(old, 'zh')).toEqual([]);
  });

  it('the toolbox shows every tool in the catalog exactly once', () => {
    const config = createStarterWorkspace('zh', registry);
    const toolbox = config.containers.pages.find((p) => p.id === 'toolbox')!;
    const shown = allComponents(toolbox).flatMap((c) =>
      isKnownComponent(c) && c.look === 'packages' ? toolGridToolIds(c, toolbox, catalog) : [],
    );
    expect([...shown].sort()).toEqual([...catalog].sort());
  });

  it('adding a tool the toolbox already shows does not add a home card', () => {
    const config = createStarterWorkspace('zh', registry);
    const result = applyOps(config, [{ op: 'setPackage', package: 'zip', do: 'add' }], {
      registry,
      locale: 'zh',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const home = result.config.containers.pages.find((p) => p.id === 'home')!;
    expect(allComponents(home).some((c) => isKnownComponent(c) && c.look === 'entry')).toBe(false);
    expect(result.config.packages.some((t) => t.id === 'zip')).toBe(true);
  });

  it('describes adding a tool the toolbox shows without a home card', () => {
    const config = createStarterWorkspace('zh', registry);
    const lines = describeChange([{ op: 'setPackage', package: 'zip', do: 'add' }], config, [], {
      registry,
      locale: 'zh',
      now: new Date(),
    });
    expect(lines.join('\n')).not.toContain('首页入口');
  });

  it('rejects tool grids with unknown or repeated tools', () => {
    const config = createStarterWorkspace('zh', registry);
    const toolbox = config.containers.pages.find((p) => p.id === 'toolbox')!;
    const grid = toolbox.blocks.find(
      (c): c is ComponentOf<'packages'> => isKnownComponent(c) && c.look === 'packages',
    )!;
    grid.source.ids = ['image', 'image', 'nope'];
    const result = validateWorkspace(config, registry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.code).sort()).toEqual(['duplicate', 'unknown-tool']);
    }
  });
});
