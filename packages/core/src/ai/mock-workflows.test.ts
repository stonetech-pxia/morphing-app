import { describe, expect, it } from 'vitest';

import { prepareOps } from '../change';
import type { Locale, WorkspaceConfig } from '../schema';
import { apply, registry, workspace } from '../test-helpers';
import { WORKFLOW_PRESETS, presetWorkflow } from '../workflows/presets';
import { createMockAIProvider } from './mock';
import type { Plan } from './types';

// 工作流句式（docs/MOCK_AI_PHRASES.md W1–W8）。

const ai = createMockAIProvider();
const now = new Date(2026, 9, 22, 9, 0);

const plan = (input: string, config: WorkspaceConfig, locale: Locale = 'zh'): Promise<Plan> =>
  ai.plan(input, { config, registry, locale });

async function change(input: string, config: WorkspaceConfig, locale: Locale = 'zh') {
  const p = await plan(input, config, locale);
  if (p.kind !== 'ops') throw new Error(`expected ops for “${input}”, got ${JSON.stringify(p)}`);
  const prepared = prepareOps(config, p.ops, { registry, locale, now });
  if (!prepared.ok) throw new Error(`invalid change for “${input}”: ${prepared.issues.join('; ')}`);
  return prepared;
}

const withVisa = () =>
  apply(workspace('zh', { withPdf: true }), [
    { op: 'addWorkflow', workflow: presetWorkflow(WORKFLOW_PRESETS[0]!, 'zh', 'visa-photo') },
  ]);
const actions = (c: WorkspaceConfig, id: string) =>
  c.workflows.find((w) => w.id === id)!.steps.map((s) => s.action);

describe('mock AI — workflows', () => {
  it('W1 adds a preset by name or by a word in it, once', async () => {
    const { after, lines } = await change('添加签证照片工作流', workspace('zh'));
    expect(after.workflows.at(-1)).toMatchObject({ id: 'visa-photo', presetId: 'visa-photo' });
    expect(lines[0]).toContain('新建快捷操作「签证 / 证件照」（现成的）');
    const en = await change('Add the scan a document preset', workspace('en'), 'en');
    expect(en.after.workflows.at(-1)!.presetId).toBe('scan-document');
    // AI 修改页「可以试试」里的英文例句。
    const example = await change('Add the visa photo workflow', workspace('en'), 'en');
    expect(example.after.workflows.at(-1)!.presetId).toBe('visa-photo');
    expect(await plan('添加签证照片工作流', withVisa())).toMatchObject({
      kind: 'reject',
      reason: 'noChange',
    });
  });

  it('W2 creates a new workflow from step phrases, Chinese commas included', async () => {
    const { after } = await change(
      '新建一个叫「发给房东」的工作流：选照片，长边 1600，压到 500KB，分享',
      workspace('zh'),
    );
    const wf = after.workflows.at(-1)!;
    expect(wf.name).toBe('发给房东');
    expect(wf.steps.map((s) => [s.action, s.params])).toEqual([
      ['in.photos', { source: 'library', min: 1, max: 30 }],
      ['image.resize', { mode: 'longEdge', px: 1600 }],
      ['image.compress', { maxKB: 500, format: 'jpeg' }],
      ['out.share', {}],
    ]);
    const en = await change(
      'Create a workflow: choose PDFs and images, merge, name it "Visa docs date", share',
      workspace('en'),
      'en',
    );
    expect(en.after.workflows.at(-1)!.steps.map((s) => s.params)).toContainEqual({
      template: 'Visa docs {date:YYYY-MM-DD}',
    });
  });

  it('W2 refuses steps it does not know or that do not fit together', async () => {
    expect(await plan('新建工作流：选照片、变成视频', workspace('zh'))).toMatchObject({
      kind: 'reject',
      reason: 'unknown',
      message: '不认识步骤「变成视频」。',
    });
    expect(await plan('新建工作流：选一个 PDF、存到相册', workspace('zh'))).toMatchObject({
      kind: 'reject',
      message: '「存到相册」接不上前一步（类型不对或参数不完整）。',
    });
    expect(await plan('新建工作流：分享', workspace('zh'))).toMatchObject({ kind: 'reject' });
  });

  it('W3–W5 renames, deletes and puts a workflow on the home page', async () => {
    const renamed = await change('把签证 / 证件照改名为美签照片', withVisa());
    expect(renamed.after.workflows.find((w) => w.id === 'visa-photo')!.name).toBe('美签照片');

    const placed = await change('把签证照片放到首页', withVisa());
    expect(
      placed.after.pages[0]!.components.some(
        (c) => c.type === 'workflowRunner' && c.props.workflowId === 'visa-photo',
      ),
    ).toBe(true);
    // 还没添加的预设：一句话里先添加再放上去。
    const fresh = await change('把扫描文档放到首页', workspace('zh'));
    expect(fresh.after.workflows.at(-1)!.presetId).toBe('scan-document');

    const removed = await change('删除签证照片工作流', placed.after);
    expect(removed.after.workflows.some((w) => w.id === 'visa-photo')).toBe(false);
    expect(JSON.stringify(removed.after.pages)).not.toContain('visa-photo');
    expect(await plan('删除合并 PDF 工作流', withVisa())).toMatchObject({
      kind: 'reject',
      message: '「合并 PDF」是工具自带的，不能单独删除；可以去掉其中的步骤，或者移除工具。',
    });
  });

  it('W6 adds a processing step before the final naming and sharing', async () => {
    const { after } = await change('在签证照片里加一步去掉定位', withVisa());
    expect(actions(after, 'visa-photo')).toEqual([
      'in.photos',
      'image.idPhoto',
      'image.stripMetadata',
      'file.rename',
    ]);
    const shared = await change('在签证照片最后加一步分享', withVisa());
    expect(actions(shared.after, 'visa-photo').at(-1)).toBe('out.share');
  });

  it('W11 shares everything at once or saves to a folder in Files (iCloud Drive, Google Drive…)', async () => {
    const { after } = await change('新建工作流：选照片，压到 500KB，一次分享', workspace('zh'));
    expect(actions(after, after.workflows.at(-1)!.id)).toEqual([
      'in.photos',
      'image.compress',
      'out.share',
    ]);
    const icloud = await change('新建工作流：选照片，存到 iCloud 的某个文件夹', workspace('zh'));
    expect(actions(icloud.after, icloud.after.workflows.at(-1)!.id).at(-1)).toBe(
      'out.saveToFolder',
    );
    const en = await change(
      'Create a workflow: choose photos, compress to 500 KB, save to a folder',
      workspace('en'),
      'en',
    );
    expect(actions(en.after, en.after.workflows.at(-1)!.id).at(-1)).toBe('out.saveToFolder');
    const added = await change('在签证照片最后加一步存到 Google Drive', withVisa());
    expect(actions(added.after, 'visa-photo').at(-1)).toBe('out.saveToFolder');
    // 只有分享面板和文件夹选择器，没有「自动发给某个人」。
    expect(await plan('新建工作流：选照片，自动发给张三', workspace('zh'))).toMatchObject({
      kind: 'reject',
    });
  });

  it('W7 changes the size limit; W8 removes a step', async () => {
    const sized = await change('把签证照片的大小改成 200KB', withVisa());
    expect(
      sized.after.workflows.find((w) => w.id === 'visa-photo')!.steps[1]!.params,
    ).toMatchObject({ maxKB: 200 });
    const packet = apply(workspace('zh'), [
      { op: 'addWorkflow', workflow: presetWorkflow(WORKFLOW_PRESETS[1]!, 'zh', 'packet') },
    ]);
    const pdf = await change('把材料包改成 2MB', packet);
    expect(pdf.after.workflows.find((w) => w.id === 'packet')!.steps[3]!.params).toMatchObject({
      maxMB: 2,
    });
    const noShare = await change('把材料包的分享这一步去掉', packet);
    expect(actions(noShare.after, 'packet')).not.toContain('out.share');
    expect(await plan('把材料包的签名这一步去掉', packet)).toMatchObject({
      kind: 'reject',
      message: '「材料包」里没有「签名」这一步。',
    });
  });

  it('still refuses to read records while building a report workflow', async () => {
    expect(await plan('我这个月花了多少', workspace('zh'))).toMatchObject({ reason: 'userData' });
  });

  it('W12–W14 videos and PDF compression: 「压到 N MB」 follows what the quick action holds', async () => {
    const { after } = await change('新建一个快捷操作：选视频，压到 50MB，分享', workspace('zh'));
    const wf = after.workflows.at(-1)!;
    expect(wf.steps.map((s) => [s.action, s.params])).toEqual([
      ['in.videos', { min: 1, max: 10 }],
      ['video.compress', { by: 'size', maxMB: 50, quality: '720p' }],
      ['out.share', {}],
    ]);
    // 往已有的视频快捷操作里加「压到 N MB」也是压视频；改大小改的是视频的 MB。
    const added = await change(`在「${wf.name}」里加一步：压到 10MB`, after);
    expect(actions(added.after, wf.id)).toEqual([
      'in.videos',
      'video.compress',
      'video.compress',
      'out.share',
    ]);
    const resized = await change(`把「${wf.name}」的大小改成 30MB`, after);
    expect(resized.after.workflows.find((w) => w.id === wf.id)!.steps[1]!.params).toMatchObject({
      by: 'size',
      maxMB: 30,
    });

    const pdf = await change('新建一个快捷操作：选 PDF，压到 500KB', workspace('zh'));
    expect(pdf.after.workflows.at(-1)!.steps[1]).toMatchObject({
      action: 'pdf.compress',
      params: { maxMB: 0.5, whenTooBig: 'ask' },
    });
    // 照片照旧压图片。
    const photos = await change('新建一个快捷操作：选照片，压到 1MB', workspace('zh'));
    expect(photos.after.workflows.at(-1)!.steps[1]).toMatchObject({
      action: 'image.compress',
      params: { maxKB: 1024 },
    });
  });
});
