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

  it('moves protected targets to floating buttons when removed from nav', () => {
    const result = applyOps(
      workspace(),
      [{ op: 'setNavItems', items: ['page:home', 'tools', 'settings'] }],
      {
        registry,
        locale: 'zh',
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.shell.floating).toEqual(['ai', 'history']);
    expect(result.notes.map((n) => n.target)).toEqual(['ai', 'history']);
    expect(validateWorkspace(result.config, registry).ok).toBe(true);
  });

  it('takes a protected target back out of floating when it returns to the nav', () => {
    const moved = apply(workspace(), [{ op: 'setNavItems', items: ['page:home', 'settings'] }]);
    const back = apply(moved, [{ op: 'setNavItems', items: ['page:home', 'ai', 'settings'] }]);
    expect(back.shell.floating).toEqual(['history']);
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
      '「AI 修改」不能删除，已改为浮动按钮',
      '「历史」不能删除，已改为浮动按钮',
    ]);
  });
});
