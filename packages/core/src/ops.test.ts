import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { applyOps } from './ops';
import { apply, registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 22, 9, 5) };

describe('applyOps', () => {
  it('does not mutate its input', () => {
    const before = workspace();
    const snapshot = JSON.stringify(before);
    apply(before, [{ op: 'setTheme', primaryColor: '#2F9E44' }]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('removes AI and History from the nav entirely; they stay reachable from Settings', () => {
    const result = applyOps(
      workspace(),
      [{ op: 'setNavItems', items: ['page:home', 'tools', 'settings'] }],
      { registry, locale: 'zh' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.shell.floating).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(validateWorkspace(result.config, registry).ok).toBe(true);
  });

  it('turns Settings into a floating button when it is removed from the nav', () => {
    const result = applyOps(workspace(), [{ op: 'setNavItems', items: ['page:home', 'ai'] }], {
      registry,
      locale: 'zh',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.shell.floating).toEqual(['settings']);
    expect(result.notes).toEqual([{ kind: 'movedToFloating', target: 'settings' }]);
    const back = apply(result.config, [{ op: 'setNavItems', items: ['page:home', 'settings'] }]);
    expect(back.shell.floating).toEqual([]);
  });

  it('setFloatingItems takes entries out of the nav', () => {
    const config = apply(workspace(), [{ op: 'setFloatingItems', items: ['ai'] }]);
    expect(config.shell.nav).toEqual(['page:home', 'tools', 'history', 'settings']);
    expect(config.shell.floating).toEqual(['ai']);
    expect(validateWorkspace(config, registry).ok).toBe(true);
  });

  it('sets and resets theme tokens and color overrides', () => {
    const styled = apply(workspace(), [
      {
        op: 'setTheme',
        fontScale: 1.15,
        radius: 8,
        density: 'compact',
        cardStyle: 'outline',
        navStyle: 'icon',
        font: 'serif',
        colors: { background: '#FFFFFF' },
      },
    ]);
    expect(styled.theme).toMatchObject({
      fontScale: 1.15,
      radius: 8,
      density: 'compact',
      cardStyle: 'outline',
      navStyle: 'icon',
      font: 'serif',
      colors: { background: '#FFFFFF' },
    });
    expect(validateWorkspace(styled, registry).ok).toBe(true);
    const cleared = apply(styled, [{ op: 'setTheme', colors: { background: null } }]);
    expect(cleared.theme.colors).toEqual({});
    expect(apply(styled, [{ op: 'resetTheme' }]).theme).toEqual(workspace().theme);
  });

  it('sets dark-mode colors separately and drops them when all are cleared', () => {
    const styled = apply(workspace(), [
      {
        op: 'setTheme',
        mode: 'system',
        cardStyle: 'brutal',
        colors: { background: '#FFF8E7', tertiary: '#3B82F6' },
        darkColors: { background: '#111111', surface: '#1C1C1C', text: '#F5F5F5' },
      },
    ]);
    expect(styled.theme.colors).toEqual({ background: '#FFF8E7', tertiary: '#3B82F6' });
    expect(styled.theme.darkColors).toEqual({
      background: '#111111',
      surface: '#1C1C1C',
      text: '#F5F5F5',
    });
    expect(validateWorkspace(styled, registry).ok).toBe(true);
    const cleared = apply(styled, [
      { op: 'setTheme', darkColors: { background: null, surface: null, text: null } },
    ]);
    expect(cleared.theme).not.toHaveProperty('darkColors');
    expect(apply(styled, [{ op: 'resetTheme' }]).theme).toEqual(workspace().theme);
  });

  it('sets a page backdrop and glass cards; resetting the theme removes the backdrop', () => {
    const styled = apply(workspace(), [{ op: 'setTheme', backdrop: 'aurora', cardStyle: 'glass' }]);
    expect(styled.theme).toMatchObject({ backdrop: 'aurora', cardStyle: 'glass' });
    expect(validateWorkspace(styled, registry).ok).toBe(true);
    expect(apply(styled, [{ op: 'resetTheme' }]).theme).not.toHaveProperty('backdrop');
  });

  it('adds a page with its own components, and removes it together with links to it', () => {
    const added = apply(workspace(), [
      {
        op: 'addPage',
        page: {
          id: 'budget',
          title: '记账',
          icon: 'chart',
          components: [{ id: 'title', type: 'header', props: { title: '记账' } }],
        },
      },
      {
        op: 'addComponent',
        pageId: 'home',
        component: {
          id: 'go-budget',
          type: 'shortcut',
          props: { title: '记账', icon: 'chart', target: 'page:budget' },
        },
      },
      { op: 'setFloatingItems', items: ['page:budget'] },
    ]);
    expect(validateWorkspace(added, registry).ok).toBe(true);

    const result = applyOps(added, [{ op: 'removePage', pageId: 'budget' }], {
      registry,
      locale: 'zh',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.pages.map((p) => p.id)).toEqual(['home']);
    expect(result.config.shell.floating).toEqual([]);
    expect(result.config.pages[0]!.components.some((c) => c.id === 'go-budget')).toBe(false);
    expect(result.notes).toEqual([{ kind: 'removedLinks', pageId: 'budget', count: 1 }]);
    expect(validateWorkspace(result.config, registry).ok).toBe(true);
  });

  it('refuses to remove the home page or a tool page', () => {
    const config = workspace('zh', { withPdf: true });
    for (const pageId of ['home', 'tool-pdf']) {
      expect(applyOps(config, [{ op: 'removePage', pageId }], { registry, locale: 'zh' }).ok).toBe(
        false,
      );
    }
  });

  it('lays components out in groups: add into, move in and out, no nesting', () => {
    const grouped = apply(workspace('zh', { withPdf: true }), [
      {
        op: 'addComponent',
        pageId: 'home',
        index: 1,
        component: {
          id: 'tools-grid',
          type: 'group',
          props: { layout: 'grid', columns: 2 },
          children: [],
        },
      },
      {
        op: 'moveComponent',
        pageId: 'home',
        componentId: 'card-pdf',
        parentId: 'tools-grid',
        toIndex: 0,
      },
      {
        op: 'moveComponent',
        pageId: 'home',
        componentId: 'catalog',
        parentId: 'tools-grid',
        toIndex: 1,
      },
    ]);
    const home = grouped.pages[0]!;
    expect(home.components.map((c) => c.id)).toEqual(['welcome', 'tools-grid', 'recent-files']);
    const group = home.components[1]!;
    expect(group.type === 'group' && group.children.map((c) => c.id)).toEqual([
      'card-pdf',
      'catalog',
    ]);
    expect(validateWorkspace(grouped, registry).ok).toBe(true);

    // 组件可以从分组里移出、修改样式、删除。
    const out = apply(grouped, [
      { op: 'moveComponent', pageId: 'home', componentId: 'catalog', toIndex: 3 },
      {
        op: 'setComponentStyle',
        pageId: 'home',
        componentId: 'card-pdf',
        style: { tone: 'secondary' },
      },
      { op: 'setComponentHidden', pageId: 'home', componentId: 'card-pdf', hidden: true },
    ]);
    expect(out.pages[0]!.components.map((c) => c.id)).toEqual([
      'welcome',
      'tools-grid',
      'recent-files',
      'catalog',
    ]);
    const card = (
      out.pages[0]!.components[1] as { children: { style?: unknown; hidden?: boolean }[] }
    ).children[0]!;
    expect(card).toMatchObject({ style: { tone: 'secondary' }, hidden: true });

    const nested = applyOps(
      grouped,
      [
        {
          op: 'addComponent',
          pageId: 'home',
          parentId: 'tools-grid',
          component: { id: 'inner', type: 'group', props: { layout: 'row' }, children: [] },
        },
      ],
      { registry, locale: 'zh' },
    );
    expect(nested).toEqual({ ok: false, error: 'a group cannot be placed inside another group' });
  });

  it('uninstalling a tool also removes its card inside a group', () => {
    const grouped = apply(workspace('zh', { withPdf: true }), [
      {
        op: 'addComponent',
        pageId: 'home',
        component: { id: 'g', type: 'group', props: { layout: 'row' }, children: [] },
      },
      { op: 'moveComponent', pageId: 'home', componentId: 'card-pdf', parentId: 'g', toIndex: 0 },
    ]);
    const removed = apply(grouped, [{ op: 'uninstallTool', toolId: 'pdf' }]);
    expect(validateWorkspace(removed, registry).ok).toBe(true);
  });

  it('style changes can be reset with null', () => {
    const styled = apply(workspace(), [
      {
        op: 'setComponentStyle',
        pageId: 'home',
        componentId: 'welcome',
        style: { align: 'center' },
      },
    ]);
    expect(styled.pages[0]!.components[0]!.style).toEqual({ align: 'center' });
    const reset = apply(styled, [
      { op: 'setComponentStyle', pageId: 'home', componentId: 'welcome', style: { align: null } },
    ]);
    expect(reset.pages[0]!.components[0]!.style).toBeUndefined();
  });

  it('installs a tool once: page, workflow and a home card before the catalog link', () => {
    const config = workspace('zh', { withPdf: true });
    expect(config.tools.map((t) => t.toolId)).toEqual(['pdf']);
    expect(config.pages.map((p) => p.id)).toEqual(['home', 'tool-pdf']);
    expect(config.workflows.map((w) => w.id)).toEqual(['pdf-merge']);
    expect(config.pages[0]!.components.map((c) => c.id)).toEqual([
      'welcome',
      'card-pdf',
      'catalog',
      'recent-files',
    ]);
    const again = applyOps(config, [{ op: 'installTool', toolId: 'pdf' }], {
      registry,
      locale: 'zh',
    });
    expect(again).toEqual({ ok: false, error: 'tool pdf is already installed' });
  });

  it('uninstalls a tool completely and leaves a valid workspace', () => {
    const config = apply(workspace('zh', { withPdf: true }), [
      { op: 'uninstallTool', toolId: 'pdf' },
    ]);
    expect(config.tools).toEqual([]);
    expect(config.workflows).toEqual([]);
    expect(config.pages.map((p) => p.id)).toEqual(['home']);
    expect(config.pages[0]!.components.some((c) => c.type === 'toolCard')).toBe(false);
    expect(validateWorkspace(config, registry).ok).toBe(true);
  });

  it('reports missing references instead of throwing', () => {
    const result = applyOps(
      workspace(),
      [{ op: 'removeComponent', pageId: 'home', componentId: 'nope' }],
      {
        registry,
        locale: 'zh',
      },
    );
    expect(result).toEqual({ ok: false, error: 'component nope not found on page home' });
  });
});

describe('prepareOps', () => {
  it('rejects malformed model output before applying anything', () => {
    const result = prepareOps(workspace(), [{ op: 'runScript', code: 'rm -rf /' }], ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe('parse');
  });

  it('rejects ops whose result fails validation', () => {
    const result = prepareOps(
      workspace(),
      [{ op: 'setComponentProps', pageId: 'home', componentId: 'welcome', props: { title: '' } }],
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe('validate');
  });

  it('describes the change in the user’s language', () => {
    const result = prepareOps(
      workspace('zh', { withPdf: true }),
      [
        { op: 'setNavItems', items: ['page:home', 'tools', 'settings'] },
        {
          op: 'setStepParams',
          workflowId: 'pdf-merge',
          stepId: 'save',
          params: { nameTemplate: '合并-{date:YYYY-MM-DD}' },
        },
      ],
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      '导航栏改为：首页、工具、设置（原来：首页、工具、AI 修改、历史、设置）',
      '「合并 PDF」的「保存到工作空间」命名规则改为 合并-{date:YYYY-MM-DD}（例如 合并-2026-10-22.pdf）',
    ]);
  });

  it('names a group created in the same change', () => {
    const result = prepareOps(
      workspace('zh', { withPdf: true }),
      [
        {
          op: 'addComponent',
          pageId: 'home',
          index: 1,
          component: { id: 'grid', type: 'group', props: { layout: 'grid' }, children: [] },
        },
        {
          op: 'moveComponent',
          pageId: 'home',
          componentId: 'card-pdf',
          parentId: 'grid',
          toIndex: 0,
        },
      ],
      ctx,
    );
    expect(result.ok && result.lines).toEqual([
      '在「首页」添加网格分组',
      '把「PDF」工具入口移到「首页」的网格分组第 1 位',
    ]);
  });

  it('describes style and page changes', () => {
    const result = prepareOps(
      workspace(),
      [
        { op: 'setTheme', fontScale: 1.15, radius: 8, cardStyle: 'flat' },
        { op: 'setNavItems', items: ['page:home', 'ai'] },
        {
          op: 'addPage',
          page: { id: 'notes', title: '笔记', components: [] },
        },
      ],
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      '字号改为115%',
      '圆角改为8',
      '卡片样式改为无阴影无描边',
      '导航栏改为：首页、AI 修改（原来：首页、工具、AI 修改、历史、设置）',
      '新建页面「笔记」（0 个组件）',
      '「设置」不能移除（AI 修改和历史入口都在里面），已改为浮动按钮',
    ]);
  });

  it('describes dark-mode colors and the new card styles', () => {
    const op = {
      op: 'setTheme',
      cardStyle: 'soft',
      colors: { tertiary: '#3B82F6' },
      darkColors: { background: '#111111' },
    } as const;
    const zh = prepareOps(workspace(), [op], ctx);
    expect(zh.ok && zh.lines).toEqual([
      '第三色改为 #3B82F6',
      '深色模式的背景色改为 #111111',
      '卡片样式改为柔和浮雕（新拟物）',
    ]);
    const glass = prepareOps(
      workspace(),
      [{ op: 'setTheme', cardStyle: 'glass', backdrop: 'aurora' }],
      ctx,
    );
    expect(glass.ok && glass.lines).toEqual(['卡片样式改为毛玻璃', '页面背景改为极光']);
    const en = prepareOps(workspace('en'), [op], { ...ctx, locale: 'en' });
    expect(en.ok && en.lines).toEqual([
      'Tertiary color → #3B82F6',
      'Dark mode background → #111111',
      'Card style → soft embossed (neumorphic)',
    ]);
  });
});
