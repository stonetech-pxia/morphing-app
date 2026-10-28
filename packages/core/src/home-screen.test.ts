import { describe, expect, it } from 'vitest';

import { splitOps } from './ai/kinds';
import { prepareOps, prepareSnapshot } from './change';
import { addedToHomeScreen, homeScreenFull, homeScreenItems } from './home-screen';
import type { Op } from './ops';
import { MAX_HOME_SCREEN, type WorkspaceConfig } from './schema';
import { apply, registry, workspace } from './test-helpers';
import { presetById, presetWorkflow } from './workflows/presets';

const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 28, 9) };

/** 装了 PDF 工具、另外加了签证照片和扫描文档两个自己的快捷操作。 */
function setup(): WorkspaceConfig {
  return apply(workspace('zh', { withPdf: true }), [
    { op: 'addWorkflow', workflow: presetWorkflow(presetById('visa-photo')!, 'zh', 'visa') },
    { op: 'addWorkflow', workflow: presetWorkflow(presetById('scan-document')!, 'zh', 'scan') },
  ]);
}

const on = (workflowId: string): Op => ({
  op: 'setWorkflowHomeScreen',
  workflowId,
  homeScreen: true,
});
const off = (workflowId: string): Op => ({
  op: 'setWorkflowHomeScreen',
  workflowId,
  homeScreen: false,
});

function prepared(before: WorkspaceConfig, ops: Op[]): WorkspaceConfig {
  const result = prepareOps(before, ops, ctx);
  if (!result.ok) throw new Error(result.issues.join('; '));
  return result.after;
}

describe('home screen mark (D-269)', () => {
  it('puts a quick action on the home screen menu and takes it off again', () => {
    const before = setup();
    expect(homeScreenItems(before)).toEqual([]);
    const after = prepared(before, [on('visa')]);
    expect(after.workflows.find((w) => w.id === 'visa')!.homeScreen).toBe(true);
    expect(homeScreenItems(after)).toEqual([
      {
        workflowId: 'visa',
        title: after.workflows.find((w) => w.id === 'visa')!.name,
        icon: presetById('visa-photo')!.icon,
      },
    ]);
    expect(addedToHomeScreen(before, after)).toEqual(['visa']);
    const removed = prepared(after, [off('visa')]);
    // 拿掉后不留 homeScreen: false，配置和放之前一样。
    expect(removed).toEqual(before);
    expect(homeScreenItems(removed)).toEqual([]);
  });

  it('works for a quick action that comes with a tool; without its own icon it uses its kind', () => {
    const after = prepared(setup(), [on('pdf-merge')]);
    expect(homeScreenItems(after)).toEqual([
      { workflowId: 'pdf-merge', title: '合并 PDF', icon: 'document' },
    ]);
  });

  it('describes the change in the interface language', () => {
    const result = prepareOps(setup(), [on('visa')], ctx);
    expect(result.ok && result.lines.join('\n')).toContain('手机桌面');
    const en = prepareOps(workspace('en', { withPdf: true }), [on('pdf-merge')], {
      ...ctx,
      locale: 'en',
    });
    expect(en.ok && en.lines[0]).toMatch(/home screen/);
    const fr = prepareOps(workspace('fr', { withPdf: true }), [off('pdf-merge')], {
      ...ctx,
      locale: 'fr',
    });
    expect(fr.ok && fr.lines[0]).toMatch(/écran d’accueil/);
  });

  it('is a function change: applied right away and undoable, not drafted', () => {
    expect(splitOps([on('visa')])).toEqual({ function: [on('visa')], look: [] });
  });

  it('refuses a quick action that does not exist', () => {
    const result = prepareOps(setup(), [on('nope')], ctx);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]).toMatch(/workflow nope not found/);
  });

  it('only setWorkflowHomeScreen puts something there: addWorkflow cannot carry the mark', () => {
    const result = prepareOps(
      setup(),
      [
        {
          op: 'addWorkflow',
          workflow: {
            ...presetWorkflow(presetById('visa-photo')!, 'zh', 'visa-2'),
            homeScreen: true,
          },
        },
      ],
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe('parse');
  });

  it(`allows at most ${MAX_HOME_SCREEN} quick actions on the home screen`, () => {
    const four = prepared(setup(), [on('visa'), on('scan'), on('pdf-merge'), on('pdf-split')]);
    expect(homeScreenFull(four)).toBe(true);
    expect(homeScreenItems(four)).toHaveLength(4);
    const fifth = four.workflows.find((w) => !w.homeScreen)!;
    const result = prepareOps(four, [on(fifth.id)], ctx);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.join()).toMatch(/at most 4 quick actions/);
    // 先拿掉一个，再放新的，一次修改里可以。
    expect(prepareOps(four, [off('scan'), on(fifth.id)], ctx).ok).toBe(true);
  });

  it('deleting a quick action takes it off the home screen menu', () => {
    const after = prepared(setup(), [on('visa'), on('scan')]);
    const deleted = prepared(after, [{ op: 'removeWorkflow', workflowId: 'visa' }]);
    expect(homeScreenItems(deleted).map((i) => i.workflowId)).toEqual(['scan']);
  });

  it('removing the tool takes its quick actions off the home screen menu', () => {
    const after = prepared(setup(), [on('pdf-merge'), on('visa')]);
    const removed = prepared(after, [{ op: 'uninstallTool', toolId: 'pdf' }]);
    expect(homeScreenItems(removed).map((i) => i.workflowId)).toEqual(['visa']);
  });

  it('renaming a quick action renames its home screen item', () => {
    const after = prepared(setup(), [on('visa')]);
    const renamed = prepared(after, [
      { op: 'renameWorkflow', workflowId: 'visa', name: '美签照片', icon: 'star' },
    ]);
    expect(homeScreenItems(renamed)).toEqual([
      { workflowId: 'visa', title: '美签照片', icon: 'star' },
    ]);
    // 编辑页保存（updateWorkflow）不会把标记弄丢。
    const saved = prepared(renamed, [
      {
        op: 'updateWorkflow',
        workflowId: 'visa',
        name: '签证',
        steps: renamed.workflows.find((w) => w.id === 'visa')!.steps,
      },
    ]);
    expect(homeScreenItems(saved).map((i) => i.title)).toEqual(['签证']);
  });

  it('undo goes back to the version before: the item is gone again', () => {
    // 撤销 = 恢复上一个版本的快照；菜单完全由配置算出来。
    const before = setup();
    const after = prepared(before, [on('visa')]);
    const restored = prepareSnapshot(JSON.parse(JSON.stringify(before)), registry);
    expect(homeScreenItems(after)).toHaveLength(1);
    expect(restored.ok && homeScreenItems(restored.after)).toEqual([]);
  });
});
