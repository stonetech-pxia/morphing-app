import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { applyOps } from './ops';
import type { Workflow } from './schema';
import { registry, workspace } from './test-helpers';
import { WORKFLOW_PRESETS, presetWorkflow } from './workflows/presets';
import { REDACTED_TEXT } from './workflow/redact';

// 工作流的修改操作（T7，D-082）：新建、删除、改名、加步骤、移动步骤、整体更新。

const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 22) };
const visa = () => presetWorkflow(WORKFLOW_PRESETS[0]!, 'zh', 'visa');

function withVisa() {
  const result = applyOps(
    workspace('zh', { withPdf: true }),
    [{ op: 'addWorkflow', workflow: visa() }],
    ctx,
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

describe('workflow ops', () => {
  it('adds a workflow from a preset and describes it step by step', () => {
    const result = prepareOps(workspace('zh'), [{ op: 'addWorkflow', workflow: visa() }], ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.after.workflows.at(-1)).toMatchObject({ id: 'visa', presetId: 'visa-photo' });
    expect(result.lines).toEqual([
      '新建快捷操作「签证 / 证件照」（现成的）：选照片 → 证件照 → 命名',
    ]);
  });

  it('refuses a workflow that does not fit together or reuses an id', () => {
    const broken: Workflow = {
      id: 'broken',
      name: '坏的',
      steps: [
        { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
        { id: 'photos', action: 'out.saveToPhotos', params: {} },
      ],
    };
    expect(prepareOps(workspace(), [{ op: 'addWorkflow', workflow: broken }], ctx)).toMatchObject({
      ok: false,
      stage: 'validate',
    });
    expect(prepareOps(withVisa(), [{ op: 'addWorkflow', workflow: visa() }], ctx)).toMatchObject({
      ok: false,
      stage: 'apply',
    });
    // 不能借 addWorkflow 冒充工具的工作流。
    expect(
      prepareOps(workspace(), [{ op: 'addWorkflow', workflow: { ...visa(), toolId: 'pdf' } }], ctx),
    ).toMatchObject({ ok: false, stage: 'parse' });
  });

  it('removes the user’s own workflow with its runner cards, but never a tool’s', () => {
    const config = withVisa();
    const placed = applyOps(
      config,
      [
        {
          op: 'addComponent',
          pageId: 'home',
          component: { id: 'run-visa', type: 'workflowRunner', props: { workflowId: 'visa' } },
        },
      ],
      ctx,
    );
    if (!placed.ok) throw new Error(placed.error);
    const removed = prepareOps(placed.config, [{ op: 'removeWorkflow', workflowId: 'visa' }], ctx);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.after.workflows.some((w) => w.id === 'visa')).toBe(false);
    expect(JSON.stringify(removed.after.pages)).not.toContain('run-visa');
    expect(removed.lines).toEqual([
      '删除快捷操作「签证 / 证件照」（文件不受影响）',
      '同时移除 1 个运行这个快捷操作的卡片',
    ]);
    expect(
      prepareOps(config, [{ op: 'removeWorkflow', workflowId: 'pdf-merge' }], ctx),
    ).toMatchObject({
      ok: false,
      stage: 'apply',
    });
  });

  it('keeps a card on a built-in quick action when the user’s copy of it is removed (D-259)', () => {
    // 用户改过内设的快捷操作，配置里的副本用预设 ID；删掉副本就回到内设的，卡片和按钮一样继续指向内设的（D-256）。
    const copy = presetWorkflow(WORKFLOW_PRESETS[0]!, 'zh', WORKFLOW_PRESETS[0]!.id);
    const placed = applyOps(
      workspace('zh'),
      [
        { op: 'addWorkflow', workflow: copy },
        {
          op: 'addComponent',
          pageId: 'home',
          component: { id: 'run-visa', type: 'workflowRunner', props: { workflowId: copy.id } },
        },
      ],
      ctx,
    );
    if (!placed.ok) throw new Error(placed.error);
    const removed = prepareOps(placed.config, [{ op: 'removeWorkflow', workflowId: copy.id }], ctx);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.after.workflows.some((w) => w.id === copy.id)).toBe(false);
    expect(removed.after.pages[0]!.components).toContainEqual(
      expect.objectContaining({ id: 'run-visa', props: { workflowId: copy.id } }),
    );
    expect(removed.lines).toEqual(['删除快捷操作「签证 / 证件照」（文件不受影响）']);
  });

  it('renames, adds, moves and removes steps', () => {
    const result = prepareOps(
      withVisa(),
      [
        { op: 'renameWorkflow', workflowId: 'visa', name: '美签照片' },
        {
          op: 'addWorkflowStep',
          workflowId: 'visa',
          step: { id: 'share', action: 'out.share', params: {} },
        },
        { op: 'moveWorkflowStep', workflowId: 'visa', stepId: 'name', toIndex: 3 },
      ],
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const wf = result.after.workflows.find((w) => w.id === 'visa')!;
    expect(wf.name).toBe('美签照片');
    expect(wf.steps.map((s) => s.id)).toEqual(['pick', 'photo', 'share', 'name']);
    expect(result.lines).toEqual([
      '快捷操作「签证 / 证件照」改名为「美签照片」',
      '「签证 / 证件照」加一步「分享」',
      '「签证 / 证件照」把「命名」移到第 4 步',
    ]);
    // 输入动作只能是第一步。
    expect(
      prepareOps(
        withVisa(),
        [{ op: 'moveWorkflowStep', workflowId: 'visa', stepId: 'pick', toIndex: 2 }],
        ctx,
      ),
    ).toMatchObject({ ok: false, stage: 'validate' });
    expect(
      prepareOps(
        withVisa(),
        [
          {
            op: 'addWorkflowStep',
            workflowId: 'visa',
            step: { id: 'name', action: 'out.share', params: {} },
          },
        ],
        ctx,
      ),
    ).toMatchObject({ ok: false, stage: 'apply' });
  });

  it('replaces the steps of a draft, keeping private text the AI only saw as a placeholder', () => {
    const base = applyOps(
      workspace('zh'),
      [
        {
          op: 'addWorkflow',
          workflow: {
            id: 'mark',
            name: '加水印',
            steps: [
              { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } },
              {
                id: 'wm',
                action: 'image.watermark',
                params: {
                  text: '仅供王小明办签证',
                  mode: 'tile',
                  corner: 'bottomRight',
                  sizePercent: 30,
                  opacity: 35,
                  color: '#868E96',
                },
              },
            ],
          },
        },
      ],
      ctx,
    );
    if (!base.ok) throw new Error(base.error);
    const result = prepareOps(
      base.config,
      [
        {
          op: 'updateWorkflow',
          workflowId: 'mark',
          name: '水印并分享',
          steps: [
            { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 5 } },
            {
              id: 'wm',
              action: 'image.watermark',
              params: {
                text: REDACTED_TEXT,
                mode: 'corner',
                corner: 'bottomRight',
                sizePercent: 30,
                opacity: 35,
                color: '#868E96',
              },
            },
            { id: 'share', action: 'out.share', params: {} },
          ],
        },
      ],
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const wf = result.after.workflows.find((w) => w.id === 'mark')!;
    expect(wf.steps[1]!.params).toMatchObject({ text: '仅供王小明办签证', mode: 'corner' });
    expect(result.lines).toEqual([
      '快捷操作「加水印」改名为「水印并分享」',
      '「水印并分享」的步骤：选照片 → 文字水印 → 分享',
    ]);
  });
});
