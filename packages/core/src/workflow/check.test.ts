import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { registry, workspace } from '../test-helpers';
import { defaultParams, insertableActions, typesAlong, workflowProblems } from './check';
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
    expect(insertableActions([], 0, registry).map((a) => a.id)).toEqual(['in.photos', 'in.files']);
  });

  it('default parameters come from the first preset or an empty object', () => {
    expect(defaultParams(registry.actions.get('file.save')!)).toEqual({});
    expect(defaultParams(registry.actions.get('in.files')!)).toBeNull();
  });
});
