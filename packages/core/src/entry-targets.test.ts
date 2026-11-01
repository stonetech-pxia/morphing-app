import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import type { Op } from './ops';
import type { NewComponent, WorkspaceConfig } from './schema';
import { apply, registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';
import { findWorkflowTarget, presetById, presetWorkflow } from './workflows/presets';

// D-256：按钮和入口可以打开一个快捷操作 tool:<id>（配置里的，或内设的预设 ID；v33 是 workflow:<id>）。
// 只打开，用户点「开始」才运行；快捷操作被移除时，打开它的按钮跟着移除（和页面一样）。

const ctx = { registry, locale: 'en' as const, now: new Date(2026, 9, 27) };

const mine = presetWorkflow(presetById('visa-photo')!, 'en', 'my-photos');
const withMine = (): WorkspaceConfig =>
  apply(workspace('en'), [{ op: 'addTool', tool: { ...mine, name: 'My photos' } }], 'en');

const button = (opens: string, id = 'open'): NewComponent =>
  ({ id, look: 'button', show: { label: 'Open', variant: 'filled' }, opens }) as NewComponent;
const shortcut = (opens: string, id = 'go'): NewComponent =>
  ({ id, look: 'entry', show: { title: 'Go', icon: 'star' }, opens }) as NewComponent;
const addOp = (block: NewComponent): Op => ({ op: 'addContainer', page: 'home', block });

const add = (config: WorkspaceConfig, block: NewComponent) =>
  prepareOps(config, [addOp(block)], ctx);

describe('buttons and entries that open a quick action (D-256)', () => {
  it('accept a quick action of the config or a built-in preset id', () => {
    const config = withMine();
    expect(add(config, button('tool:my-photos')).ok).toBe(true);
    expect(add(config, shortcut('tool:email-photos')).ok).toBe(true);
  });

  it('reject a quick action that does not exist, or a malformed target', () => {
    const config = withMine();
    expect(add(config, button('tool:nope'))).toMatchObject({
      ok: false,
      stage: 'validate',
      issues: ['component open on page home opens missing quick action nope'],
    });
    expect(add(config, shortcut('tool:Bad Id')).ok).toBe(false);
    // v33 的写法不再认。
    expect(add(config, button('workflow:my-photos')).ok).toBe(false);
  });

  it('are removed with the quick action they open, with a note', () => {
    const config = apply(withMine(), [
      addOp(button('tool:my-photos')),
      addOp(shortcut('tool:my-photos')),
    ]);
    const removed = prepareOps(config, [{ op: 'removeTool', tool: 'my-photos' }], ctx);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const ids = removed.after.containers.pages[0]!.blocks.map((c) => c.id);
    expect(ids).not.toContain('open');
    expect(ids).not.toContain('go');
    expect(removed.lines).toContain('Also removes 2 buttons or shortcuts that opened “My photos”');
  });

  it('keep pointing at a built-in quick action when the user’s copy of it is removed', () => {
    const copy = presetWorkflow(presetById('email-photos')!, 'en', 'email-photos');
    const config = apply(workspace('en'), [
      { op: 'addTool', tool: copy },
      addOp(button('tool:email-photos')),
    ]);
    const removed = prepareOps(config, [{ op: 'removeTool', tool: 'email-photos' }], ctx);
    expect(
      removed.ok && removed.after.containers.pages[0]!.blocks.some((c) => c.id === 'open'),
    ).toBe(true);
  });

  it('open the user’s edited copy of a built-in quick action', () => {
    expect(findWorkflowTarget([], 'visa-photo', 'en')).toMatchObject({ id: 'visa-photo' });
    const copy = { ...presetWorkflow(presetById('visa-photo')!, 'en', 'visa-photo-2') };
    expect(findWorkflowTarget([copy], 'visa-photo', 'en')).toBe(copy);
    expect(findWorkflowTarget([copy], 'nope', 'en')).toBeUndefined();
  });

  it('pass the stored config check', () => {
    const config = apply(withMine(), [addOp(button('tool:my-photos'))]);
    expect(validateWorkspace(JSON.parse(JSON.stringify(config)), registry).ok).toBe(true);
  });
});
