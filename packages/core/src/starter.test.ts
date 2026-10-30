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
import { fromV33, registry, v33Fixture } from './test-helpers';
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
      fromV33(v33Fixture(`starter-${locale}`)),
    );
  });

  it('adds the two file entries side by side once (D-231)', () => {
    const config = createStarterWorkspace('zh', registry);
    const ops = homeFileEntryOps(config);
    const result = applyOps(config, ops, { registry, locale: 'zh' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 和 v33 的 filePick 迁移过来的一样（fixtures/v33/starter-files-zh.json）。
    expect(result.config).toEqual(fromV33(v33Fixture('starter-files-zh')));
    const home = result.config.containers.pages.find((p) => p.id === 'home')!;
    expect((home.blocks[0] as ComponentOf<'group'>).children).toMatchObject([
      { look: 'picker', tools: [{ tool: '$pick.media' }] },
      { look: 'picker', tools: [{ tool: '$pick.files' }] },
    ]);
    expect(homeFileEntryOps(result.config)).toEqual([]);
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
