import { DESK_MAX_VERSIONS, currentFiles, type RunValue } from '@morph/core';
import type { DocDoc, TableDoc } from '@morph/tool-office';

import {
  clearDesk,
  commitRun,
  deskPicked,
  listDesks,
  loadDesk,
  loadDeskSource,
  placeOnDesk,
  redo,
  undo,
} from '../desk/store';
import { FakeFiles } from '../test-utils/fake-files';

// 桌面的存储（file-room DESIGN §3、§11.1，D-357）：原件只复制；运行目录的结果移进来；
// 中间格式的图片搬进 assets/、JSON 写相对路径；撤销重做存下来；超过上限的旧版本的文件删掉。

const bytes = (n: number) => new Uint8Array(n).fill(7);
const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const files = new FakeFiles();
  // 相册的原件（content://）和选择器放在缓存里的副本：都不属于桌面。
  files.disk.set('content://media/photo1', bytes(300));
  files.disk.set('picker://ImagePicker/scan.pdf', bytes(500));
  return files;
}

const original = [
  {
    uri: 'content://media/photo1',
    name: 'IMG_0001.HEIC.jpg',
    size: 300,
    mimeType: 'image/jpeg',
    width: 40,
    height: 30,
  },
  {
    uri: 'picker://ImagePicker/scan.pdf',
    name: '报告.pdf',
    size: 500,
    mimeType: 'application/pdf',
  },
];

/** 一次运行在运行目录里产出的文件。 */
function runFile(files: FakeFiles, runId: string, name: string, n = 100) {
  const uri = `runs/${runId}/${name}`;
  files.disk.set(uri, bytes(n));
  return uri;
}

describe('放到桌上', () => {
  it('每份复制一份工作副本，原件不动；桌面写成 desk.json', async () => {
    const files = setup();
    const desk = await placeOnDesk(files, original, 1000, 'd1');
    expect(files.disk.has('content://media/photo1')).toBe(true);
    expect(files.disk.has('picker://ImagePicker/scan.pdf')).toBe(true);
    expect(files.desk.moved).toEqual([]);
    expect(currentFiles(desk).map((f) => [f.name, f.ext, f.path, f.size])).toEqual([
      ['IMG_0001.HEIC', 'jpg', 'v1-0.jpg', 300],
      ['报告', 'pdf', 'v1-1.pdf', 500],
    ]);
    expect(files.disk.get('desk/d1/v1-0.jpg')).toEqual(bytes(300));
    expect(await loadDesk(files, 'd1')).toEqual(desk);
    // 交给运行时：用桌上的副本，不是原件。
    expect(deskPicked(files, desk, currentFiles(desk)).map((p) => p.uri)).toEqual([
      'desk/d1/v1-0.jpg',
      'desk/d1/v1-1.pdf',
    ]);
  });

  it('手机空间不够时不复制、不留下半个桌面', async () => {
    const files = setup();
    files.freeBytes = 200;
    await expect(placeOnDesk(files, original, 1000, 'd1')).rejects.toMatchObject({
      code: 'notEnoughSpace',
    });
    expect(await files.desk.list()).toEqual([]);
  });
});

describe('工具的结果放回桌上', () => {
  it('运行目录里的结果移进桌面，生成新版本；撤销、重做存下来', async () => {
    const files = setup();
    let desk = await placeOnDesk(files, original.slice(0, 1), 1000, 'd1');
    const out = runFile(files, 'r1', 'IMG_0001-small.jpg', 80);
    const value: RunValue = {
      type: 'images',
      items: [{ uri: out, name: 'IMG_0001-small', ext: 'jpg', mimeType: 'image/jpeg', size: 80 }],
    };
    ({ desk } = await commitRun(
      files,
      desk,
      ['f1-0'],
      value,
      { kind: 'action', action: 'image.compress' },
      2000,
    ));
    expect(files.desk.moved).toEqual([out]);
    expect(files.disk.has(out)).toBe(false);
    expect(currentFiles(desk).map((f) => [f.id, f.path, f.size])).toEqual([
      ['f2-0', 'v2-0.jpg', 80],
    ]);
    // 第 1 版的文件还在（能撤销）。
    expect(files.disk.has('desk/d1/v1-0.jpg')).toBe(true);

    desk = await undo(files, desk, 3000);
    expect((await loadDesk(files, 'd1'))?.current).toBe(0);
    desk = await redo(files, desk, 4000);
    expect((await loadDesk(files, 'd1'))?.current).toBe(1);
    expect((await loadDesk(files, 'd1'))?.touchedAt).toBe(4000);
  });

  it('文字结果（识别文字）不生成版本，只交回文字', async () => {
    const files = setup();
    const desk = await placeOnDesk(files, original.slice(0, 1), 1000, 'd1');
    const result = await commitRun(
      files,
      desk,
      ['f1-0'],
      { type: 'text', text: '识别出的字', name: 'x' },
      { kind: 'action', action: 'ocr.recognize' },
      2000,
    );
    expect(result.text).toBe('识别出的字');
    expect(result.desk).toBe(desk);
    expect((await loadDesk(files, 'd1'))?.versions).toHaveLength(1);
  });

  it('快捷操作把桌上的文件原样交回（最后一步是分享）：不生成新版本', async () => {
    const files = setup();
    const desk = await placeOnDesk(files, original.slice(0, 1), 1000, 'd1');
    const item = {
      uri: 'desk/d1/v1-0.jpg',
      name: 'IMG_0001.HEIC',
      ext: 'jpg',
      mimeType: 'image/jpeg',
      size: 300,
    };
    const result = await commitRun(
      files,
      desk,
      ['f1-0'],
      { type: 'images', items: [item] },
      { kind: 'workflow', workflowId: 'w' },
      2000,
    );
    expect(result.desk).toBe(desk);
  });

  it('超过 20 个版本时，最旧的版本的文件从磁盘上删掉', async () => {
    const files = setup();
    let desk = await placeOnDesk(files, original.slice(0, 1), 1000, 'd1');
    for (let i = 0; i < DESK_MAX_VERSIONS; i++) {
      const out = runFile(files, `r${i}`, `p${i}.jpg`);
      ({ desk } = await commitRun(
        files,
        desk,
        currentFiles(desk).map((f) => f.id),
        {
          type: 'images',
          items: [{ uri: out, name: `p${i}`, ext: 'jpg', mimeType: 'image/jpeg', size: 100 }],
        },
        { kind: 'action', action: 'image.rotate' },
        2000 + i,
      ));
    }
    expect(desk.versions).toHaveLength(DESK_MAX_VERSIONS);
    expect(desk.versions[0]!.n).toBe(2);
    expect(files.disk.has('desk/d1/v1-0.jpg')).toBe(false);
    expect(files.disk.has('desk/d1/v2-0.jpg')).toBe(true);
  });
});

describe('版本里的中间格式（§11.1）', () => {
  const tableDoc = (source: string): TableDoc => ({
    version: 2,
    scope: 'all',
    pages: [
      {
        name: 'Sheet1',
        source,
        width: 100,
        height: 100,
        lineHeight: 10,
        colWidths: [50, 50],
        blocks: [{ kind: 'text', text: '标题', box: { x: 0, y: 0, width: 10, height: 10 } }],
      },
    ],
  });

  it('转 Excel：xlsx、TableDoc、原图都进桌面；JSON 里写相对路径，读出来时换成现在的地址', async () => {
    const files = setup();
    let desk = await placeOnDesk(files, original.slice(0, 1), 1000, 'd1');
    const page = runFile(files, 'r1', 'input-0.jpg', 300);
    const xlsx = runFile(files, 'r1', '表格.xlsx', 50);
    const json = `runs/r1/表格.json`;
    files.disk.set(json, new TextEncoder().encode(JSON.stringify(tableDoc(page))));
    ({ desk } = await commitRun(
      files,
      desk,
      ['f1-0'],
      {
        type: 'files',
        items: [
          {
            uri: xlsx,
            name: '表格',
            ext: 'xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: 50,
            tableDoc: { uri: json, for: xlsx, pagesWithoutTables: [1] },
          },
        ],
      },
      { kind: 'action', action: 'ocr.toExcel' },
      2000,
    ));
    const [sheet] = currentFiles(desk);
    expect(sheet!.source).toMatchObject({
      kind: 'table',
      path: 'v2-0.json',
      pagesWithoutTables: [1],
      assets: [{ path: 'assets/v2-0-0.jpg', size: 300 }],
    });
    const stored = JSON.parse((await files.desk.readText('d1/v2-0.json'))!) as TableDoc;
    expect(stored.pages[0]!.source).toBe('assets/v2-0-0.jpg');
    expect(files.disk.has(page)).toBe(false);
    const loaded = await loadDeskSource(files, desk, sheet!);
    expect(loaded?.kind === 'table' && loaded.doc.pages[0]!.source).toBe(
      'desk/d1/assets/v2-0-0.jpg',
    );
    // 退回照片那一版，中间格式还在（重做后还能看）。
    desk = await undo(files, desk, 3000);
    expect(currentFiles(desk)[0]!.ext).toBe('jpg');
    desk = await redo(files, desk, 4000);
    expect(currentFiles(desk)[0]!.source?.path).toBe('v2-0.json');
  });

  it('转 Word：剪下来的图片也进 assets/；同一张图只存一份', async () => {
    const files = setup();
    let desk = await placeOnDesk(files, original.slice(0, 1), 1000, 'd1');
    const page = runFile(files, 'r1', 'input-0.jpg', 300);
    const crop = runFile(files, 'r1', 'word/1-1.jpg', 40);
    const docx = runFile(files, 'r1', '文档.docx', 60);
    const doc: DocDoc = {
      version: 1,
      pages: [
        {
          source: page,
          width: 100,
          height: 100,
          bodySize: 11,
          blocks: [
            { kind: 'image', box: { x: 0, y: 0, width: 10, height: 10 }, src: crop },
            { kind: 'image', box: { x: 0, y: 20, width: 10, height: 10 }, src: crop },
          ],
        },
      ],
    };
    files.disk.set('runs/r1/文档.json', new TextEncoder().encode(JSON.stringify(doc)));
    ({ desk } = await commitRun(
      files,
      desk,
      ['f1-0'],
      {
        type: 'files',
        items: [
          {
            uri: docx,
            name: '文档',
            ext: 'docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: 60,
            docDoc: { uri: 'runs/r1/文档.json', for: docx },
          },
        ],
      },
      { kind: 'action', action: 'ocr.toWord' },
      2000,
    ));
    const [word] = currentFiles(desk);
    expect(word!.source?.assets.map((a) => a.path)).toEqual([
      'assets/v2-0-0.jpg',
      'assets/v2-0-1.jpg',
    ]);
    const loaded = await loadDeskSource(files, desk, word!);
    const blocks = loaded?.kind === 'doc' ? loaded.doc.pages[0]!.blocks : [];
    expect(blocks.map((b) => (b.kind === 'image' ? b.src : null))).toEqual([
      'desk/d1/assets/v2-0-1.jpg',
      'desk/d1/assets/v2-0-1.jpg',
    ]);
  });

  it('后面的步骤生成了新文件（中间格式不是为它存的）：这一版没有中间格式', async () => {
    const files = setup();
    let desk = await placeOnDesk(files, original.slice(0, 1), 1000, 'd1');
    const xlsx = runFile(files, 'r1', 'b.xlsx');
    ({ desk } = await commitRun(
      files,
      desk,
      ['f1-0'],
      {
        type: 'files',
        items: [
          {
            uri: xlsx,
            name: 'b',
            ext: 'xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: 100,
            tableDoc: { uri: 'runs/r1/a.json', for: 'runs/r1/a.xlsx' },
          },
        ],
      },
      { kind: 'workflow', workflowId: 'w' },
      2000,
    ));
    expect(currentFiles(desk)[0]!.source).toBeUndefined();
  });
});

describe('清理', () => {
  it('列出所有桌面，7 天没动的标出来；清空桌面删掉整个目录，原件不动', async () => {
    const files = setup();
    await placeOnDesk(files, original.slice(0, 1), 1000, 'old');
    await placeOnDesk(files, original.slice(1), 9 * DAY, 'new');
    const desks = await listDesks(files);
    expect(desks.map((d) => d.id)).toEqual(['new', 'old']);
    await clearDesk(files, 'old');
    expect(await loadDesk(files, 'old')).toBeNull();
    expect([...files.disk.keys()].filter((k) => k.startsWith('desk/old/'))).toEqual([]);
    expect(files.disk.has('content://media/photo1')).toBe(true);
  });
});
