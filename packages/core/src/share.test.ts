import { describe, expect, it } from 'vitest';

import type { Workflow } from './schema';
import { acceptsSharedFile, shareFit, sharedSizeProblem, type SharedFileInfo } from './share';
import { workspace } from './test-helpers';
import { WORKFLOW_PRESETS, presetWorkflow } from './workflows/presets';

const MB = 1024 * 1024;
const jpg = (name = 'a', size = 1000): SharedFileInfo => ({
  name: `${name}.jpg`,
  mimeType: 'image/jpeg',
  size,
});
const pdf = (name = 'a', size = 1000): SharedFileInfo => ({
  name: `${name}.pdf`,
  mimeType: 'application/pdf',
  size,
});
const mov = (name = 'a', size = 1000): SharedFileInfo => ({
  name: `${name}.mov`,
  mimeType: 'video/quicktime',
  size,
});
const m4a: SharedFileInfo = { name: 'memo.m4a', mimeType: 'audio/mp4', size: 1000 };
const docx: SharedFileInfo = {
  name: 'notes.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: 1000,
};

const preset = (id: string) =>
  presetWorkflow(
    WORKFLOW_PRESETS.find((p) => p.id === id)!,
    'zh',
    id,
  );
const merge = () => workspace('zh', { withPdf: true }).workflows.find((w) => w.toolId === 'pdf')!;
const withFirst = (action: string, params: Record<string, unknown>): Workflow => ({
  id: 'w',
  name: 'w',
  steps: [{ id: 's', action, params }],
});

describe('shareFit', () => {
  it('a photo workflow takes shared images, whatever its photo source', () => {
    expect(shareFit(preset('visa-photo'), [jpg()])).toEqual({ ok: true, type: 'images' });
    expect(shareFit(preset('scan-document'), [jpg('1'), jpg('2')])).toEqual({
      ok: true,
      type: 'images',
    });
    expect(shareFit(preset('visa-photo'), [pdf()])).toEqual({ ok: false, reason: 'type' });
    expect(shareFit(preset('visa-photo'), [jpg(), pdf()])).toEqual({ ok: false, reason: 'type' });
  });

  it('a file workflow checks its accepted type and gives the matching value type', () => {
    expect(merge().steps[0]!.params).toMatchObject({ accept: 'pdf', min: 2 });
    expect(shareFit(merge(), [pdf('1'), pdf('2')])).toEqual({ ok: true, type: 'pdf' });
    expect(shareFit(preset('combine-documents'), [pdf(), jpg()])).toEqual({
      ok: true,
      type: 'files',
    });
    expect(shareFit(preset('combine-documents'), [docx])).toEqual({ ok: false, reason: 'type' });
    expect(shareFit(withFirst('in.files', { accept: 'any', min: 1, max: 5 }), [docx])).toEqual({
      ok: true,
      type: 'files',
    });
  });

  it('reports a count the first step does not allow', () => {
    expect(shareFit(merge(), [pdf()])).toEqual({ ok: false, reason: 'tooFew', min: 2 });
    expect(shareFit(preset('sign-return'), [pdf('1'), pdf('2')])).toEqual({
      ok: false,
      reason: 'tooMany',
      max: 1,
    });
  });

  it('workflows that start with text or records never take files', () => {
    expect(shareFit(withFirst('in.text', { text: '' }), [jpg()])).toEqual({
      ok: false,
      reason: 'type',
    });
    expect(
      shareFit(withFirst('in.records', { collectionId: 'c', period: 'all' }), [jpg()]),
    ).toEqual({ ok: false, reason: 'type' });
    expect(shareFit(preset('visa-photo'), [])).toEqual({ ok: false, reason: 'type' });
  });

  it('a video workflow takes shared videos (D-135)', () => {
    expect(shareFit(preset('video-too-big'), [mov('1'), mov('2')])).toEqual({
      ok: true,
      type: 'video',
    });
    expect(shareFit(preset('video-too-big'), [jpg()])).toEqual({ ok: false, reason: 'type' });
    expect(shareFit(preset('visa-photo'), [mov()])).toEqual({ ok: false, reason: 'type' });
    expect(shareFit(withFirst('in.files', { accept: 'videos', min: 1, max: 3 }), [mov()])).toEqual({
      ok: true,
      type: 'video',
    });
    expect(shareFit(withFirst('in.files', { accept: 'audio', min: 1, max: 3 }), [m4a])).toEqual({
      ok: true,
      type: 'audio',
    });
    expect(shareFit(withFirst('in.files', { accept: 'audio', min: 1, max: 3 }), [mov()])).toEqual({
      ok: false,
      reason: 'type',
    });
  });

  it('zip only takes zip archives', () => {
    expect(acceptsSharedFile('zip', 'application/zip')).toBe(true);
    expect(acceptsSharedFile('zip', 'application/pdf')).toBe(false);
    expect(acceptsSharedFile('nonsense', 'application/pdf')).toBe(false);
  });
});

describe('sharedSizeProblem (P-006)', () => {
  it('applies the same limits as the pickers', () => {
    expect(sharedSizeProblem([pdf('a', 10 * MB)])).toBeNull();
    expect(sharedSizeProblem([pdf('big', 51 * MB)])).toEqual({
      code: 'tooLarge',
      detail: { name: 'big.pdf', mb: 50 },
    });
    expect(sharedSizeProblem([pdf('1', 40 * MB), pdf('2', 40 * MB), pdf('3', 40 * MB)])).toEqual({
      code: 'tooLargeTotal',
      detail: { mb: 100 },
    });
    // 视频和音频单独算：单个 4 GB，最多 10 个，不计入 100 MB 的合计（D-133）。
    expect(sharedSizeProblem([mov('1', 900 * MB), mov('2', 900 * MB), pdf('a', 10 * MB)])).toBe(
      null,
    );
    expect(sharedSizeProblem([mov('huge', 4097 * MB)])).toEqual({
      code: 'tooLarge',
      detail: { name: 'huge.mov', mb: 4096 },
    });
    expect(sharedSizeProblem(Array.from({ length: 11 }, (_, i) => mov(String(i))))).toEqual({
      code: 'tooMany',
      detail: { max: 10 },
    });
    // 不知道大小的文件先放行，复制进来之后再按实际大小检查。
    expect(sharedSizeProblem([{ name: 'x.pdf', mimeType: 'application/pdf', size: null }])).toBe(
      null,
    );
  });
});
