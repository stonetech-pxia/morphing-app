import { describe, expect, it } from 'vitest';

import { createRegistry } from '../registry';
import { WorkspaceConfigSchema, type Workflow } from '../schema';
import { BUILTIN_TOOLS } from '../tools';
import { workspace } from '../test-helpers';
import { DEFAULT_DESK_LAYOUT, DeskLayoutSchema, resolveDeskLayout } from './layout';
import type { DeskFile } from './model';
import {
  defaultDeskTools,
  deskInputStep,
  deskToolWorkflow,
  deskToolbar,
  deskWorkflowFits,
} from './tools';

// 房间的工具栏和布局配置（file-room DESIGN §4、§5，D-337、D-338）。

const registry = createRegistry(BUILTIN_TOOLS);

const f = (ext: string, mimeType: string, id = ext): DeskFile => ({
  id,
  name: id,
  ext,
  mimeType,
  size: 1000,
  path: `${id}.${ext}`,
});
const jpg = f('jpg', 'image/jpeg');
const pdf = f('pdf', 'application/pdf');
const xlsx = f('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
const docx = f('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

const actionsIn = (groups: ReturnType<typeof defaultDeskTools>, id: string) =>
  groups.find((g) => g.id === id)?.items.flatMap((i) => ('action' in i ? [i.action] : [])) ?? [];

describe('默认工具栏：按文件种类从注册表生成', () => {
  it('图片：编辑里是要亲手操作的（裁剪、标注、打码），处理是类型不变的，转换是换了类型的', () => {
    const groups = defaultDeskTools('image', registry, [], 'zh');
    expect(groups.map((g) => g.id)).toEqual(['edit', 'adjust', 'convert', 'quick']);
    expect(actionsIn(groups, 'edit')).toEqual(
      expect.arrayContaining(['image.crop', 'image.annotate', 'image.redact', 'scan.detect']),
    );
    expect(actionsIn(groups, 'adjust')).toEqual(
      expect.arrayContaining(['image.rotate', 'image.compress', 'scan.enhance']),
    );
    expect(actionsIn(groups, 'convert')).toEqual(
      expect.arrayContaining(['pdf.fromImages', 'ocr.toExcel', 'ocr.toWord', 'ocr.recognize']),
    );
    // 选文件、保存、分享、命名不是工具（房间的「完成」管它们）。
    const all = groups.flatMap((g) => g.items.flatMap((i) => ('action' in i ? [i.action] : [])));
    expect(all.filter((a) => /^(in|out|file)\./.test(a))).toEqual([]);
    // 图片没有 PDF、视频的工具。
    expect(all.filter((a) => /^(pdf\.(compress|sign)|video\.)/.test(a))).toEqual([]);
  });

  it('PDF：签名、整理页面在编辑里，压缩、加页码在处理里，转图片在转换里', () => {
    const groups = defaultDeskTools('pdf', registry, [], 'zh');
    expect(actionsIn(groups, 'edit')).toEqual(expect.arrayContaining(['pdf.sign', 'pdf.pages']));
    expect(actionsIn(groups, 'adjust')).toEqual(
      expect.arrayContaining(['pdf.compress', 'pdf.pageNumbers', 'pdf.rotate']),
    );
    expect(actionsIn(groups, 'convert')).toEqual(
      expect.arrayContaining(['pdf.toImages', 'pdf.extractText']),
    );
    expect(actionsIn(groups, 'adjust')).not.toContain('image.rotate');
  });

  it('Excel、Word：只有转 PDF（合并、打包这种收任何文件的不放）', () => {
    for (const kind of ['sheet', 'doc'] as const) {
      const groups = defaultDeskTools(kind, registry, [], 'zh');
      const all = groups.flatMap((g) => g.items.flatMap((i) => ('action' in i ? [i.action] : [])));
      expect(all).toEqual(['pdf.fromDocument']);
    }
  });

  it('认不出的文件没有工具', () => {
    expect(defaultDeskTools('other', registry, [], 'zh')).toEqual([]);
  });

  it('快捷操作：接得上这种文件的，自己的在前；工具自带的单功能快捷操作不放（和工具重复）', () => {
    const own: Workflow = {
      id: 'mine',
      name: '我的',
      steps: [
        { id: 's1', action: 'in.photos', params: { source: 'library', min: 1, max: 30 } },
        { id: 's2', action: 'image.compress', params: { maxKB: 500, format: 'jpeg' } },
      ],
    };
    const tool: Workflow = { ...own, id: 'tool-one', toolId: 'image' };
    const pdfOnly: Workflow = {
      id: 'pdf-only',
      name: 'PDF',
      steps: [{ id: 's1', action: 'in.files', params: { accept: 'pdf', min: 1, max: 10 } }],
    };
    const quick = defaultDeskTools('image', registry, [tool, pdfOnly, own], 'zh').find(
      (g) => g.id === 'quick',
    )!;
    const ids = quick.items.map((i) => ('workflowId' in i ? i.workflowId : ''));
    expect(ids[0]).toBe('mine');
    expect(ids).not.toContain('tool-one');
    expect(ids).not.toContain('pdf-only');
    expect(ids.length).toBeLessThanOrEqual(8);
  });
});

describe('用一个工具 = 输入 + 这个工具', () => {
  it('输入步骤按桌上文件的种类和个数选', () => {
    expect(deskInputStep([jpg, { ...jpg, id: 'b' }])).toMatchObject({
      action: 'in.photos',
      params: { min: 1, max: 2 },
    });
    expect(deskInputStep([pdf])).toMatchObject({ action: 'in.files', params: { accept: 'pdf' } });
    expect(deskInputStep([xlsx])).toMatchObject({
      action: 'in.files',
      params: { accept: 'documents' },
    });
    expect(deskInputStep([jpg, pdf])).toMatchObject({
      action: 'in.files',
      params: { accept: 'pdfOrImages' },
    });
    expect(deskInputStep([f('mov', 'video/quicktime')])).toMatchObject({ action: 'in.videos' });
  });

  it('接得上的工具得到一个能通过检查的工作流；接不上的返回 null（工具栏上变灰）', () => {
    expect(deskToolWorkflow('image.rotate', [jpg], registry)?.steps.map((s) => s.action)).toEqual([
      'in.photos',
      'image.rotate',
    ]);
    expect(deskToolWorkflow('pdf.compress', [jpg], registry)).toBeNull();
    expect(deskToolWorkflow('pdf.fromDocument', [docx], registry)).not.toBeNull();
    // 选输入、分享不能当工具。
    expect(deskToolWorkflow('out.share', [jpg], registry)).toBeNull();
    expect(deskToolWorkflow('nope.nope', [jpg], registry)).toBeNull();
    expect(deskToolWorkflow('image.rotate', [], registry)).toBeNull();
  });

  it('默认参数不完整（文字戳要写字）时先算接得上；填好的参数不对时接不上', () => {
    expect(deskToolWorkflow('pdf.stamp', [pdf], registry)).not.toBeNull();
    expect(deskToolWorkflow('pdf.stamp', [pdf], registry, { text: '' })).toBeNull();
  });

  it('快捷操作能不能作用到桌上的文件：看第一步收不收', () => {
    const photos: Workflow = {
      id: 'p',
      name: 'p',
      steps: [{ id: 's1', action: 'in.photos', params: { source: 'library', min: 1, max: 30 } }],
    };
    expect(deskWorkflowFits(photos, [jpg])).toBe(true);
    expect(deskWorkflowFits(photos, [pdf])).toBe(false);
    expect(deskWorkflowFits(photos, [])).toBe(false);
  });
});

describe('布局配置（创始人 2026-10-30 确认：默认预览居中、工具栏在底部，AI 以后能改）', () => {
  it('没有配置时：工具栏在底部，预览占满，有文件条，预览上下没有组件', () => {
    expect(resolveDeskLayout(undefined)).toEqual(DEFAULT_DESK_LAYOUT);
    expect(DEFAULT_DESK_LAYOUT).toMatchObject({ toolbar: 'bottom', preview: 'fill', strip: true });
  });

  it('能改工具栏位置、预览大小、文件条、预览上下的说明组件、每种文件的工具', () => {
    const layout = DeskLayoutSchema.parse({
      toolbar: 'top',
      preview: 'medium',
      strip: false,
      above: [{ id: 'tip', type: 'notice', props: { text: '先找边' } }],
      tools: { pdf: [{ title: '常用', items: [{ action: 'pdf.sign' }, { workflowId: 'mine' }] }] },
    });
    const resolved = resolveDeskLayout(layout);
    expect(resolved).toMatchObject({ toolbar: 'top', preview: 'medium', strip: false });
    expect(resolved.above.map((c) => c.type)).toEqual(['notice']);
    expect(resolved.tools.pdf).toHaveLength(1);
  });

  it('没有能让预览消失、能碰文件的写法；预览上下只能放说明和入口', () => {
    expect(DeskLayoutSchema.safeParse({ preview: 'none' }).success).toBe(false);
    expect(DeskLayoutSchema.safeParse({ files: [] }).success).toBe(false);
    expect(DeskLayoutSchema.safeParse({ hidePreview: true }).success).toBe(false);
    const form = {
      id: 'f',
      type: 'recordForm',
      props: { collectionId: 'c' },
    };
    expect(DeskLayoutSchema.safeParse({ below: [form] }).success).toBe(false);
    // 编辑层的工具（插入行、删块）不是动作，写不进工具栏。
    expect(
      DeskLayoutSchema.safeParse({ tools: { sheet: [{ items: [{ edit: 'insertRow' }] }] } })
        .success,
    ).toBe(false);
  });

  it('配置里写了的种类用配置的，指向已经没有的工具、快捷操作的项不显示；没写的种类用默认的', () => {
    const configured = {
      pdf: [{ title: '常用', items: [{ action: 'pdf.sign' }, { workflowId: 'gone' }] }],
    };
    expect(deskToolbar('pdf', configured, registry, [], 'zh')).toEqual([
      { title: '常用', items: [{ action: 'pdf.sign' }] },
    ]);
    expect(deskToolbar('image', configured, registry, [], 'zh')).toEqual(
      defaultDeskTools('image', registry, [], 'zh'),
    );
  });

  it('工作空间配置里可以有 desk，也可以没有', () => {
    const config = workspace('zh');
    expect(WorkspaceConfigSchema.safeParse(config).success).toBe(true);
    expect(WorkspaceConfigSchema.safeParse({ ...config, desk: { toolbar: 'top' } }).success).toBe(
      true,
    );
    expect(WorkspaceConfigSchema.safeParse({ ...config, desk: { toolbar: 'left' } }).success).toBe(
      false,
    );
  });
});
