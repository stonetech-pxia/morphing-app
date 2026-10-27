import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import type { Op } from './ops';
import type { NewComponent, WorkspaceConfig } from './schema';
import { apply, registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';
import { findWorkflowTarget, presetById, presetWorkflow } from './workflows/presets';

// D-256：按钮和快捷入口可以打开一个快捷操作 workflow:<id>（配置里的，或内设的预设 ID）。
// 只打开，用户点「开始」才运行；快捷操作被移除时，打开它的按钮跟着移除（和页面一样）。

const ctx = { registry, locale: 'en' as const, now: new Date(2026, 9, 27) };

const mine = presetWorkflow(presetById('visa-photo')!, 'en', 'my-photos');
const withMine = (): WorkspaceConfig =>
  apply(workspace('en'), [{ op: 'addWorkflow', workflow: { ...mine, name: 'My photos' } }], 'en');

const button = (target: string, id = 'open'): NewComponent =>
  ({ id, type: 'button', props: { label: 'Open', target, variant: 'filled' } }) as NewComponent;
const shortcut = (target: string, id = 'go'): NewComponent =>
  ({ id, type: 'shortcut', props: { title: 'Go', icon: 'star', target } }) as NewComponent;

const add = (config: WorkspaceConfig, component: NewComponent) =>
  prepareOps(config, [{ op: 'addComponent', pageId: 'home', component }], ctx);

describe('buttons and shortcuts that open a quick action (D-256)', () => {
  it('accept a quick action of the config or a built-in preset id', () => {
    const config = withMine();
    expect(add(config, button('workflow:my-photos')).ok).toBe(true);
    expect(add(config, shortcut('workflow:email-photos')).ok).toBe(true);
  });

  it('reject a quick action that does not exist, or a malformed target', () => {
    const config = withMine();
    expect(add(config, button('workflow:nope'))).toMatchObject({
      ok: false,
      stage: 'validate',
      issues: ['component open on page home opens missing workflow:nope'],
    });
    expect(add(config, shortcut('workflow:Bad Id')).ok).toBe(false);
  });

  it('are removed with the quick action they open, with a note', () => {
    const config = apply(withMine(), [
      { op: 'addComponent', pageId: 'home', component: button('workflow:my-photos') },
      { op: 'addComponent', pageId: 'home', component: shortcut('workflow:my-photos') },
    ]);
    const removed = prepareOps(config, [{ op: 'removeWorkflow', workflowId: 'my-photos' }], ctx);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const ids = removed.after.pages[0]!.components.map((c) => c.id);
    expect(ids).not.toContain('open');
    expect(ids).not.toContain('go');
    expect(removed.lines).toContain('Also removes 2 buttons or shortcuts that opened “My photos”');
  });

  it('keep pointing at a built-in quick action when the user’s copy of it is removed', () => {
    const copy = presetWorkflow(presetById('email-photos')!, 'en', 'email-photos');
    const config = apply(workspace('en'), [
      { op: 'addWorkflow', workflow: copy },
      { op: 'addComponent', pageId: 'home', component: button('workflow:email-photos') },
    ] as Op[]);
    const removed = prepareOps(config, [{ op: 'removeWorkflow', workflowId: 'email-photos' }], ctx);
    expect(removed.ok && removed.after.pages[0]!.components.some((c) => c.id === 'open')).toBe(
      true,
    );
  });

  it('open the user’s edited copy of a built-in quick action', () => {
    expect(findWorkflowTarget([], 'visa-photo', 'en')).toMatchObject({ id: 'visa-photo' });
    const copy = { ...presetWorkflow(presetById('visa-photo')!, 'en', 'visa-photo-2') };
    expect(findWorkflowTarget([copy], 'visa-photo', 'en')).toBe(copy);
    expect(findWorkflowTarget([copy], 'nope', 'en')).toBeUndefined();
  });

  it('pass the stored config check', () => {
    const config = apply(withMine(), [
      { op: 'addComponent', pageId: 'home', component: button('workflow:my-photos') },
    ]);
    expect(validateWorkspace(JSON.parse(JSON.stringify(config)), registry).ok).toBe(true);
  });
});
