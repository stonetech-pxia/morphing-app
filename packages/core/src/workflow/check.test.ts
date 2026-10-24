import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createDefaultWorkspace } from '../defaults';
import { apply, registry, workspace } from '../test-helpers';
import {
  defaultParams,
  initialParams,
  insertableActions,
  typesAlong,
  workflowProblems,
} from './check';
import { acceptsType } from './contract';

const merge = () => workspace('zh', { withPdf: true }).workflows[0]!;

describe('action contracts', () => {
  it.each([...registry.actions.values()].map((a) => [a.id, a] as const))(
    '%s: fields match the parameter schema and presets are valid',
    (_id, action) => {
      const json = z.toJSONSchema(action.params) as { properties?: Record<string, unknown> };
      const keys = Object.keys(json.properties ?? {}).sort();
      expect(action.fields.map((f) => f.key).sort()).toEqual(keys);
      for (const preset of action.presets ?? []) {
        expect(action.params.safeParse(preset.values).success, preset.id).toBe(true);
      }
      for (const field of action.fields) {
        if (field.showIf) expect(keys).toContain(field.showIf.key);
        if (field.kind === 'choice') expect(field.options?.length).toBeGreaterThan(0);
      }
      expect(action.label.zh && action.label.en && action.description.zh).toBeTruthy();
    },
  );
});

describe('built-in tools', () => {
  it.each([...registry.tools.keys()].map((id) => [id]))(
    '%s installs in both languages and every workflow passes the static checks',
    (toolId) => {
      for (const locale of ['zh', 'en'] as const) {
        const config = apply(
          createDefaultWorkspace(locale),
          [{ op: 'installTool', toolId }],
          locale,
        );
        const own = config.workflows.filter((w) => w.toolId === toolId);
        // 报表工具没有自带的工作流（要先有数据表）。
        if (toolId !== 'print') expect(own.length).toBeGreaterThan(0);
        for (const wf of own) expect(workflowProblems(wf, registry)).toEqual([]);
      }
    },
  );
});

describe('types', () => {
  it('files accepts every file type, but not the other way round', () => {
    expect(acceptsType(['files'], 'images')).toBe(true);
    expect(acceptsType(['files'], 'pdf')).toBe(true);
    expect(acceptsType(['files'], 'text')).toBe(false);
    expect(acceptsType(['images'], 'files')).toBe(false);
  });

  it('follows the value type through the steps', () => {
    expect(typesAlong(merge().steps, registry)).toEqual(['pdf', 'pdf', 'pdf', 'pdf']);
    const wf = merge();
    wf.steps.splice(1, 0, { id: 'photos', action: 'out.saveToPhotos', params: {} });
    expect(typesAlong(wf.steps, registry)).toEqual(['pdf', null, null, null, null]);
    expect(workflowProblems(wf, registry).map((p) => p.code)).toEqual(['binding']);
  });

  it('only offers actions whose types fit at the insertion point', () => {
    const steps = merge().steps;
    const ids = (i: number) => insertableActions(steps, i, registry).map((a) => a.id);
    // 第一步已经是输入动作，前面不能再插。
    expect(ids(0)).toEqual([]);
    // 选完 PDF 之后：不能插「存到相册」（只接受图片）。
    expect(ids(1)).toContain('pdf.merge');
    expect(ids(1)).not.toContain('out.saveToPhotos');
    expect(ids(1)).not.toContain('in.photos');
    expect(ids(4)).toContain('out.share');
    expect(insertableActions([], 0, registry).map((a) => a.id)).toEqual([
      'in.photos',
      'in.files',
      'in.videos',
      'in.audio',
      'in.text',
      'in.records',
    ]);
  });

  it('video and audio are files, but merging PDFs does not take them (D-140)', () => {
    expect(acceptsType(['files'], 'video')).toBe(true);
    expect(acceptsType(['files'], 'audio')).toBe(true);
    expect(acceptsType(['video'], 'files')).toBe(false);
    const steps = [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 2 } },
      { id: 'merge', action: 'pdf.merge', params: {} },
    ];
    const wf = { id: 'v', name: 'v', steps };
    expect(workflowProblems(wf, registry)).toEqual([
      expect.objectContaining({
        code: 'binding',
        message: 'v/merge: pdf.merge does not take video',
      }),
    ]);
    const ids = insertableActions(steps.slice(0, 1), 1, registry).map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(['video.compress', 'out.share', 'out.saveToPhotos', 'zip.create']),
    );
    expect(ids).not.toContain('pdf.merge');
    expect(ids).not.toContain('image.compress');
    const audio = insertableActions(
      [{ id: 'pick', action: 'in.files', params: { accept: 'audio', min: 1, max: 1 } }],
      1,
      registry,
    ).map((a) => a.id);
    expect(audio).toContain('out.share');
    expect(audio).not.toContain('out.saveToPhotos');
    expect(audio).not.toContain('video.compress');
  });

  it('default parameters come from the first preset or an empty object', () => {
    expect(defaultParams(registry.actions.get('file.save')!)).toEqual({});
    expect(defaultParams(registry.actions.get('in.files')!)).toEqual({
      accept: 'pdf',
      min: 1,
      max: 10,
    });
    expect(defaultParams(registry.actions.get('in.records')!)).toBeNull();
    expect(defaultParams(registry.actions.get('out.addRecord')!)).toBeNull();
  });

  it('every action except the ones that need a data table gets valid starting parameters', () => {
    for (const action of registry.actions.values()) {
      // 读取记录、记一笔（D-187）要先选一张表。
      if (action.fields.some((f) => f.kind === 'collection')) continue;
      expect(action.params.safeParse(initialParams(action)).success, action.id).toBe(true);
    }
    // 读取记录要先选一张表：初始值让编辑页提示用户选。
    expect(initialParams(registry.actions.get('in.records')!)).toMatchObject({ period: 'all' });
  });
});
