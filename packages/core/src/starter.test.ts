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
import { DEFAULT_THEME, STARTER_THEME } from './theme';
import { findWorkflowTarget } from './workflows/presets';
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

  // D-487 只换了默认风格（theme）；其余仍然是 v33 的起始配置迁移过来的样子（底线 12）。
  it.each(['zh', 'en'] as const)(
    'is the v33 starter, migrated, except the D-487 theme (%s)',
    (locale) => {
      const { theme, ...rest } = createStarterWorkspace(locale, registry);
      const { theme: oldTheme, ...oldRest } = withScanKeep(
        fromV33(v33Fixture(`starter-${locale}`)),
      );
      expect(rest).toEqual(oldRest);
      expect(theme).toEqual(STARTER_THEME);
      expect(oldTheme).toEqual(DEFAULT_THEME);
    },
  );

  // D-487：默认风格在 Clay 的基础上：黏土卡片、淡淡的暖色渐变、浅底彩色图标；主色和字体不变。
  it('uses the refined Clay theme by default', () => {
    const { theme } = createStarterWorkspace('en', registry);
    expect(theme).toMatchObject({
      primaryColor: '#C8623A',
      font: 'clay',
      cardStyle: 'puffy',
      backdrop: 'gradient',
      iconStyle: 'tint',
    });
    expect(validateWorkspace(createStarterWorkspace('en', registry), registry).ok).toBe(true);
  });

  // D-487：首页先说产品是什么，再放四个内设的快捷操作宫格（扫成 PDF / Word / Excel、合并文件），
  // 下面是主色的「打开文件」、工具箱入口、最近操作、最近文件。
  it('puts a header, the four marquee quick actions and an Open files button on the home page', () => {
    const config = createStarterWorkspace('en', registry);
    const result = applyOps(config, homeFileEntryOps(config, 'en'), { registry, locale: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateWorkspace(result.config, registry).ok).toBe(true);
    const home = result.config.containers.pages.find((p) => p.id === 'home')!;
    expect(home.blocks[0]).toMatchObject({
      look: 'header',
      show: { title: 'Tinkrum', subtitle: 'Paper in. Clean PDF, Word or Excel out.' },
    });
    expect(home.blocks[1]).toMatchObject({ look: 'group', show: { layout: 'grid', columns: 2 } });
    expect((home.blocks[1] as ComponentOf<'group'>).children).toMatchObject([
      { look: 'action', show: { shape: 'tile' }, tools: [{ tool: 'scan-camera' }] },
      { look: 'action', show: { shape: 'tile' }, tools: [{ tool: 'scan-doc-word' }] },
      { look: 'action', show: { shape: 'tile' }, tools: [{ tool: 'scan-table-excel' }] },
      { look: 'action', show: { shape: 'tile' }, tools: [{ tool: 'combine-documents' }] },
    ]);
    // 每个宫格里的快捷操作都是内设的预设，不用添加就能点。
    for (const c of (home.blocks[1] as ComponentOf<'group'>).children) {
      const use = (c as ComponentOf<'action'>).tools[0]!;
      expect(
        'tool' in use && findWorkflowTarget(quickActionsOf(result.config), use.tool, 'en'),
      ).toBeTruthy();
    }
    expect(home.blocks[2]).toMatchObject({ look: 'picker', tools: [{ tool: '$pick.open' }] });
    // 没写 shape：主色的整行按钮，不是只有图标的小块。
    expect((home.blocks[2] as ComponentOf<'picker'>).show).toBeUndefined();
    // D-452：最后是最近操作（读运行记录）和最近的 3 个文件。
    expect(home.blocks.slice(4)).toMatchObject([
      { look: 'library', show: { title: 'Recent actions' }, source: { recent: true } },
      { look: 'files', show: { title: 'Recent files' }, source: { table: '$files', limit: 3 } },
    ]);
    expect(homeFileEntryOps(result.config, 'en')).toEqual([]);
  });

  it('leaves out a scan tile when the scan tool is not installed', () => {
    const config = { ...createStarterWorkspace('en', registry) };
    config.packages = config.packages.filter((p) => p.id !== 'scan');
    const result = applyOps(config, homeFileEntryOps(config, 'en'), { registry, locale: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const home = result.config.containers.pages.find((p) => p.id === 'home')!;
    const group = home.blocks.find((b) => b.look === 'group') as ComponentOf<'group'>;
    expect(group.children).toMatchObject([{ tools: [{ tool: 'combine-documents' }] }]);
  });

  it('puts a Toolbox button right under the Open files button; it opens the toolbox page', () => {
    const config = createStarterWorkspace('zh', registry);
    const result = applyOps(config, homeFileEntryOps(config, 'zh'), { registry, locale: 'zh' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateWorkspace(result.config, registry).ok).toBe(true);
    const home = result.config.containers.pages.find((p) => p.id === 'home')!;
    expect(home.blocks[3]).toMatchObject({
      look: 'button',
      show: { label: '工具箱', icon: 'apps' },
      opens: 'page:toolbox',
    });
    expect(home.blocks[4]).toMatchObject({ look: 'library' });
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
