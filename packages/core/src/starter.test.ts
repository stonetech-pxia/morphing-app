import { describe, expect, it } from 'vitest';

import { describeChange } from './describe';
import { applyOps } from './ops';
import { allComponents, toolGridToolIds, type Component } from './schema';
import { STARTER_TOOL_IDS, createStarterWorkspace } from './starter';
import { registry } from './test-helpers';
import { validateWorkspace } from './validate';

const catalog = [...registry.tools.keys()];

describe('createStarterWorkspace', () => {
  it.each(['zh', 'en', 'fr'] as const)(
    'installs the starter tools, a three-item bar and a short home page (%s)',
    (locale) => {
      const config = createStarterWorkspace(locale, registry);
      expect(validateWorkspace(config, registry).ok).toBe(true);
      expect(config.tools.map((t) => t.toolId)).toEqual([...STARTER_TOOL_IDS]);
      expect(config.shell.nav).toEqual(['page:home', 'ai', 'settings']);
      const home = config.pages.find((p) => p.id === 'home')!;
      // 标题、并排文件入口、功能分类和工具箱；不预装或展示用户快捷操作。
      expect(home.components.map((c) => c.type)).toEqual([
        'header',
        'group',
        'shortcut',
        'shortcut',
      ]);
      expect((home.components[1] as Extract<Component, { type: 'group' }>).children).toMatchObject([
        { type: 'filePick', props: { source: 'media' } },
        { type: 'filePick', props: { source: 'files' } },
      ]);
      expect(home.components[2]).toMatchObject({
        type: 'shortcut',
        props: { target: 'quickActions' },
      });
      expect(home.components[3]).toMatchObject({
        type: 'shortcut',
        props: { target: 'page:toolbox' },
      });
      expect(config.workflows.filter((w) => !w.toolId)).toEqual([]);
      expect(allComponents(home).some((c) => c.type === 'workflowRunner')).toBe(false);
    },
  );

  it('the toolbox shows every tool in the catalog exactly once', () => {
    const config = createStarterWorkspace('zh', registry);
    const toolbox = config.pages.find((p) => p.id === 'toolbox')!;
    const shown = allComponents(toolbox).flatMap((c) =>
      c.type === 'toolGrid' ? toolGridToolIds(c, toolbox, catalog) : [],
    );
    expect([...shown].sort()).toEqual([...catalog].sort());
  });

  it('adding a tool the toolbox already shows does not add a home card', () => {
    const config = createStarterWorkspace('zh', registry);
    const result = applyOps(config, [{ op: 'installTool', toolId: 'zip' }], {
      registry,
      locale: 'zh',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const home = result.config.pages.find((p) => p.id === 'home')!;
    expect(allComponents(home).some((c) => c.type === 'toolCard')).toBe(false);
    expect(result.config.tools.some((t) => t.toolId === 'zip')).toBe(true);
  });

  it('describes adding a tool the toolbox shows without a home card', () => {
    const config = createStarterWorkspace('zh', registry);
    const lines = describeChange([{ op: 'installTool', toolId: 'zip' }], config, [], {
      registry,
      locale: 'zh',
      now: new Date(),
    });
    expect(lines.join('\n')).not.toContain('首页入口');
  });

  it('rejects tool grids with unknown or repeated tools', () => {
    const config = createStarterWorkspace('zh', registry);
    const toolbox = config.pages.find((p) => p.id === 'toolbox')!;
    const grid = toolbox.components.find((c) => c.type === 'toolGrid')!;
    (grid.props as { toolIds: string[] }).toolIds = ['image', 'image', 'nope'];
    const result = validateWorkspace(config, registry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.code).sort()).toEqual(['duplicate', 'unknown-tool']);
    }
  });
});
