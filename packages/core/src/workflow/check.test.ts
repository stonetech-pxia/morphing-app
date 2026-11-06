import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createDefaultWorkspace } from '../defaults';
import { quickActionsOf, type Workflow } from '../schema';
import { apply, registry, workspace } from '../test-helpers';
import {
  defaultParams,
  handedInput,
  handedValueType,
  initialParams,
  insertableActions,
  typesAlong,
  workflowProblems,
} from './check';
import { acceptsType } from './contract';
import { describeParams } from './format';

const merge = () => quickActionsOf(workspace('zh', { withPdf: true }))[0]!;

describe('action contracts', () => {
  it.each([...registry.actions.values()].map((a) => [a.id, a] as const))(
    '%s: fields match the parameter schema and presets are valid',
    (_id, action) => {
      const json = z.toJSONSchema(action.params) as { properties?: Record<string, unknown> };
      const keys = Object.keys(json.properties ?? {}).sort();
      // 密码（secret）不在参数结构里：每次运行时问，不保存（D-194）。
      const saved = action.fields.filter((f) => f.kind !== 'secret');
      expect(saved.map((f) => f.key).sort()).toEqual(keys);
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
          [{ op: 'setPackage', package: toolId, do: 'add' }],
          locale,
        );
        const own = quickActionsOf(config).filter((w) => w.package === toolId);
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
      'in.wifi',
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
    const wf = { id: 'v', kind: 'quickAction' as const, name: 'v', steps };
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

describe('a first step that takes what a container hands over (D-428)', () => {
  const steps = (...actions: string[]) =>
    actions.map((action, i) => ({
      id: `s${i}`,
      action,
      params: registry.actions.get(action)!.params.safeParse({}).success
        ? {}
        : initialParams(registry.actions.get(action)!),
    }));
  const wf = (...actions: string[]): Workflow => ({
    id: 'w',
    kind: 'quickAction',
    name: 'W',
    steps: steps(...actions),
  });

  it('text and records can start a chain, and the chain is typed from there', () => {
    expect(workflowProblems(wf('out.call'), registry)).toEqual([]);
    expect(typesAlong(wf('records.toVCardText', 'qr.generate').steps, registry)).toEqual([
      'text',
      'images',
    ]);
    expect(handedInput(wf('records.toVCard').steps, registry)).toBe('records');
    expect(handedInput(wf('text.copy').steps, registry)).toBe('text');
  });

  it('text.toDocx is a text tool that turns handed text into files, in the same place as text.toPdf', () => {
    const toDocx = registry.actions.get('text.toDocx');
    expect(toDocx).toBeDefined();
    expect(registry.actionOwner.get('text.toDocx')).toBe('text');
    expect(toDocx!.input).toEqual(['text']);
    expect(toDocx!.output).toBe('files');
    // 容器交一段文字，一步就出 Word；后面能接分享和存文件。
    expect(workflowProblems(wf('text.toDocx'), registry)).toEqual([]);
    expect(handedInput(wf('text.toDocx').steps, registry)).toBe('text');
    expect(typesAlong(wf('text.toDocx', 'out.share').steps, registry)).toEqual(['files', 'files']);
    // 自己输入文字也行。
    expect(workflowProblems(wf('in.text', 'text.toDocx', 'file.save'), registry)).toEqual([]);
    // 和 text.toPdf 一样只收文字，不收图片。
    expect(workflowProblems(wf('in.photos', 'text.toDocx'), registry).map((p) => p.code)).toContain(
      'binding',
    );
  });

  it('a step that takes files can start a chain: the container hands over the attachments (D-442)', () => {
    expect(handedInput(wf('pdf.compress').steps, registry)).toBe('files');
    expect(handedInput(wf('image.resize').steps, registry)).toBe('files');
    expect(handedInput(wf('file.save').steps, registry)).toBe('files');
    // 后面各步按第一步收的那种文件接：pdf 压缩完还是 pdf，能接分享。
    expect(handedValueType(wf('pdf.compress').steps, registry)).toBe('pdf');
    expect(handedValueType(wf('image.resize').steps, registry)).toBe('images');
    expect(handedValueType(wf('file.save').steps, registry)).toBe('files');
    expect(workflowProblems(wf('pdf.compress', 'out.share'), registry)).toEqual([]);
    expect(typesAlong(wf('pdf.compress', 'out.share').steps, registry)).toEqual(['pdf', 'pdf']);
    // 类型接不上还是接不上：图片动作后面不能接只收 pdf 的。
    expect(
      workflowProblems(wf('image.resize', 'pdf.compress'), registry).map((p) => p.code),
    ).toContain('binding');
  });

  it('text and records win when a step takes them as well as files', () => {
    expect(handedInput(wf('out.addRecord').steps, registry)).toBe('text');
  });

  it('a step that takes files can still not follow an input step the wrong way round', () => {
    expect(handedInput(wf('in.files', 'pdf.compress').steps, registry)).toBeNull();
    expect(handedValueType(wf('in.files', 'pdf.compress').steps, registry)).toBeNull();
  });

  it('an input step stays first, and an input step is not handed anything', () => {
    expect(workflowProblems(wf('text.copy', 'in.text'), registry).map((p) => p.code)).toContain(
      'source',
    );
    expect(handedInput(wf('in.text', 'text.copy').steps, registry)).toBeNull();
  });

  it('the editor still only offers input actions as the first step', () => {
    const first = insertableActions([], 0, registry);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((a) => a.input.length === 0)).toBe(true);
  });
});

// 2026-11-06 模拟器测试：桌上点「加页码」，起始页码默认 0、字号 6pt，第 2 页显示成「1 / 2」。
describe('initialParams for page numbers', () => {
  it('starts at page 1 with a readable size', () => {
    const params = initialParams(registry.actions.get('pdf.pageNumbers')!);
    expect(params.startAt).toBe(1);
    expect(params.fontSize).toBeGreaterThanOrEqual(9);
  });
});

// 2026-11-06 模拟器测试：首页卡片写「不超过 0 MB」，其实 0 是不限大小；法语写「MB」，应该是 Mo。
describe('describeParams for sizes', () => {
  const action = registry.actions.get('pdf.fromImages')!;
  it('says no size limit for 0', () => {
    const text = describeParams(action, { maxMB: 0 }, 'zh', new Date(), ['maxMB']);
    expect(text).toBe('大小不限');
    expect(describeParams(action, { maxMB: 0 }, 'fr', new Date(), ['maxMB'])).toBe(
      'Taille illimitée',
    );
  });
  it('writes Mo in French', () => {
    expect(describeParams(action, { maxMB: 4 }, 'fr', new Date(), ['maxMB'])).toBe('Au plus 4 Mo');
  });
});
