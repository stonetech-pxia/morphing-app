import { describe, expect, it } from 'vitest';

import {
  DESK_LIMITS,
  DESK_STALE_DAYS,
  blobsOf,
  canRedo,
  canUndo,
  commitVersion,
  currentFiles,
  currentVersion,
  deskBytes,
  deskKindOf,
  isStaleDesk,
  moveTo,
  newDesk,
  parseDesk,
  placeOutputs,
  redoDesk,
  sealEdit,
  undoDesk,
  type Desk,
  type DeskFile,
} from './model';

// 桌上的工作文件和版本栈（file-room DESIGN §3、§11.1，D-336）。

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

function file(id: string, ext = 'jpg', size = 1 * MB, extra: Partial<DeskFile> = {}): DeskFile {
  const mime: Record<string, string> = {
    jpg: 'image/jpeg',
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return {
    id,
    name: id,
    ext,
    mimeType: mime[ext] ?? 'application/octet-stream',
    size,
    path: `${id}.${ext}`,
    ...extra,
  };
}

/** 放上一份，再用 n 次工具，每次换一份新文件。 */
function deskWith(n: number, size = 1 * MB): Desk {
  let desk = newDesk('d1', [file('f0', 'jpg', size)], 0);
  for (let i = 1; i <= n; i++) {
    desk = commitVersion(
      desk,
      [file(`f${i}`, 'jpg', size)],
      { kind: 'action', action: 'image.compress' },
      i,
    ).desk;
  }
  return desk;
}

describe('版本栈', () => {
  it('放上桌是第 1 版；用一次工具多一版，现在显示的是新的', () => {
    const desk = newDesk('d1', [file('a')], 100);
    expect(desk.versions.map((v) => v.n)).toEqual([1]);
    expect(currentVersion(desk).by).toEqual({ kind: 'place' });
    const { desk: next, drop } = commitVersion(
      desk,
      [file('b')],
      { kind: 'action', action: 'image.rotate' },
      200,
    );
    expect(next.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(currentFiles(next).map((f) => f.id)).toEqual(['b']);
    expect(next.touchedAt).toBe(200);
    // 第 1 版还在（能撤销），它的文件不能删。
    expect(drop).toEqual([]);
  });

  it('撤销、重做在版本之间移动，不删任何版本', () => {
    const desk = deskWith(2);
    expect(canUndo(desk)).toBe(true);
    expect(canRedo(desk)).toBe(false);
    const back = undoDesk(desk, 10);
    expect(currentFiles(back).map((f) => f.id)).toEqual(['f1']);
    expect(back.versions).toHaveLength(3);
    expect(canRedo(back)).toBe(true);
    const twice = undoDesk(back, 11);
    expect(canUndo(twice)).toBe(false);
    expect(undoDesk(twice, 12)).toBe(twice);
    expect(currentFiles(redoDesk(twice, 13)).map((f) => f.id)).toEqual(['f1']);
    // 退到任意一步。
    expect(currentFiles(moveTo(desk, 0, 14)).map((f) => f.id)).toEqual(['f0']);
  });

  it('撤销以后再用工具：后面的版本丢掉，只有它们用到的文件可以删', () => {
    const desk = undoDesk(deskWith(2), 10);
    const { desk: next, drop } = commitVersion(
      desk,
      [file('g')],
      { kind: 'action', action: 'image.resize' },
      20,
    );
    expect(next.versions.map((v) => v.n)).toEqual([1, 2, 4]);
    expect(currentFiles(next).map((f) => f.id)).toEqual(['g']);
    expect(canRedo(next)).toBe(false);
    expect(drop).toEqual(['f2.jpg']);
  });

  it('最多留 20 个版本：从最旧的删起，删掉的版本的文件可以删', () => {
    let desk = deskWith(DESK_LIMITS.maxVersions - 1);
    expect(desk.versions).toHaveLength(20);
    const { desk: next, drop } = commitVersion(
      desk,
      [file('new')],
      { kind: 'action', action: 'image.compress' },
      99,
    );
    desk = next;
    expect(desk.versions).toHaveLength(20);
    expect(desk.versions[0]!.n).toBe(2);
    expect(currentFiles(desk).map((f) => f.id)).toEqual(['new']);
    expect(drop).toEqual(['f0.jpg']);
  });

  it('所有版本合起来超过 500 MB 时也从最旧的删起（先到哪个上限算哪个）', () => {
    // 4 个 150 MB 的版本放不下：只留最近 3 个。
    expect(deskBytes(deskWith(3, 150 * MB))).toBe(450 * MB);
    const limited = commitVersion(
      deskWith(2, 150 * MB),
      [file('f3', 'jpg', 150 * MB)],
      { kind: 'action', action: 'image.compress' },
      9,
    );
    expect(limited.desk.versions.map((v) => v.n)).toEqual([2, 3, 4]);
    expect(limited.drop).toEqual(['f0.jpg']);
  });

  it('只有一个版本也比上限大时（很大的视频），现在这一版照样留着', () => {
    const big = commitVersion(
      newDesk('d', [file('a', 'jpg', 10 * MB)], 0),
      [file('b', 'jpg', 600 * MB)],
      { kind: 'action', action: 'image.compress' },
      1,
    );
    expect(big.desk.versions.map((v) => v.n)).toEqual([2]);
    expect(currentFiles(big.desk).map((f) => f.id)).toEqual(['b']);
    expect(big.drop).toEqual(['a.jpg']);
  });

  it('没变的文件在几个版本里共用，只算一次大小、删掉旧版本时也不删它', () => {
    const a = file('a', 'jpg', 5 * MB);
    const b = file('b', 'jpg', 5 * MB);
    let desk = newDesk('d', [a, b], 0);
    desk = commitVersion(
      desk,
      [file('a2', 'jpg', 2 * MB), b],
      { kind: 'action', action: 'image.compress' },
      1,
    ).desk;
    expect(deskBytes(desk)).toBe(12 * MB);
    const { drop } = commitVersion(
      desk,
      [file('c', 'pdf', 1 * MB)],
      { kind: 'action', action: 'pdf.fromImages' },
      2,
      {
        maxVersions: 2,
        maxBytes: DESK_LIMITS.maxBytes,
      },
    );
    // 第 1 版删掉了：a 只有它用，b 第 2 版还在用。
    expect(drop).toEqual(['a.jpg']);
  });
});

describe('连续的编辑合成一个版本（§10 第 4 题）', () => {
  const edit = { kind: 'edit' } as const;
  const table = (id: string, json: string) =>
    file(id, 'xlsx', 10_000, {
      source: {
        kind: 'table',
        path: json,
        size: 2_000,
        assets: [{ path: 'assets/p1.jpg', size: MB }],
      },
    });

  it('第一次编辑生成一个还没合上的版本，接着编辑替换它，不另生成版本', () => {
    let desk = newDesk('d', [table('t1', 't1.json')], 0);
    let change = commitVersion(desk, [table('t2', 't2.json')], edit, 1);
    desk = change.desk;
    expect(desk.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(currentVersion(desk).open).toBe(true);
    change = commitVersion(desk, [table('t3', 't3.json')], edit, 2);
    desk = change.desk;
    expect(desk.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(currentFiles(desk).map((f) => f.id)).toEqual(['t3']);
    // 被替换掉的那一份可以删；原图（各版本共用）不删。
    expect(change.drop).toEqual(['t2.xlsx', 't2.json']);
  });

  it('合上以后（用了别的工具、撤销、离开房间）再编辑，是新的一版；撤销整段一起退', () => {
    let desk = commitVersion(
      newDesk('d', [table('t1', 't1.json')], 0),
      [table('t2', 't2.json')],
      edit,
      1,
    ).desk;
    desk = sealEdit(desk);
    expect(currentVersion(desk).open).toBeUndefined();
    desk = commitVersion(desk, [table('t3', 't3.json')], edit, 2).desk;
    expect(desk.versions.map((v) => v.n)).toEqual([1, 2, 3]);
    // 用别的工具时编辑那一版合上。
    desk = commitVersion(
      desk,
      [file('p', 'pdf')],
      { kind: 'action', action: 'pdf.fromDocument' },
      3,
    ).desk;
    expect(desk.versions[2]!.open).toBeUndefined();
    // 撤销：先回到编辑过的表格（整段），再回到上一段。
    desk = undoDesk(desk, 4);
    expect(currentFiles(desk).map((f) => f.id)).toEqual(['t3']);
    expect(currentVersion(desk).open).toBeUndefined();
  });

  it('撤销时合上编辑：撤销后接着编辑不会改掉撤销到的那一版', () => {
    let desk = commitVersion(
      newDesk('d', [table('t1', 't1.json')], 0),
      [table('t2', 't2.json')],
      edit,
      1,
    ).desk;
    desk = undoDesk(desk, 2);
    expect(desk.versions[1]!.open).toBeUndefined();
    const { desk: next } = commitVersion(desk, [table('t3', 't3.json')], edit, 3);
    expect(next.versions.map((v) => v.n)).toEqual([1, 3]);
    expect(currentFiles(next).map((f) => f.id)).toEqual(['t3']);
  });
});

describe('版本里的中间格式（§11.1）', () => {
  it('一个文件用到的：它自己、中间格式、中间格式引用的图片', () => {
    const f = file('t', 'xlsx', 10, {
      source: {
        kind: 'table',
        path: 't.json',
        size: 20,
        assets: [
          { path: 'assets/p1.jpg', size: 30 },
          { path: 'assets/p2.jpg', size: 40 },
        ],
      },
    });
    expect(blobsOf(f)).toEqual([
      { path: 't.xlsx', size: 10 },
      { path: 't.json', size: 20 },
      { path: 'assets/p1.jpg', size: 30 },
      { path: 'assets/p2.jpg', size: 40 },
    ]);
  });

  it('类型变了（图片转 Excel，再转 PDF）：退一步回到带中间格式的那一版，最后一个用到图片的版本删掉时才删图片', () => {
    const photo = file('photo', 'jpg', 3 * MB);
    const sheet = file('sheet', 'xlsx', 20_000, {
      source: {
        kind: 'table',
        path: 'sheet.json',
        size: 4_000,
        assets: [{ path: 'assets/page.jpg', size: 2 * MB }],
      },
    });
    let desk = newDesk('d', [photo], 0);
    desk = commitVersion(desk, [sheet], { kind: 'action', action: 'ocr.toExcel' }, 1).desk;
    desk = commitVersion(
      desk,
      [file('out', 'pdf', MB)],
      { kind: 'action', action: 'pdf.fromDocument' },
      2,
    ).desk;
    // 转成 PDF 的那一版没有中间格式。
    expect(currentFiles(desk)[0]!.source).toBeUndefined();
    const back = undoDesk(desk, 3);
    expect(currentFiles(back)[0]!.source?.path).toBe('sheet.json');
    expect(deskKindOf(currentFiles(back)[0]!)).toBe('sheet');
    // 只留 1 个版本时，表格那一版和它的图片都删掉。
    const { drop } = commitVersion(
      desk,
      [file('z', 'pdf')],
      { kind: 'action', action: 'pdf.compress' },
      4,
      {
        maxVersions: 1,
        maxBytes: DESK_LIMITS.maxBytes,
      },
    );
    expect(drop.sort()).toEqual([
      'assets/page.jpg',
      'out.pdf',
      'photo.jpg',
      'sheet.json',
      'sheet.xlsx',
    ]);
  });
});

describe('工具的结果放回桌上（§3.1）', () => {
  const desk = [file('a'), file('b'), file('c')];
  const ids = (files: DeskFile[] | null) => files?.map((f) => f.id) ?? null;

  it('一对一：替换用到的那一份，位置不变', () => {
    expect(ids(placeOutputs(desk, ['b'], [file('b2')]))).toEqual(['a', 'b2', 'c']);
  });
  it('多合一：用到的几份变成一份，放在第一份的位置', () => {
    expect(ids(placeOutputs(desk, ['b', 'c'], [file('pdf', 'pdf')]))).toEqual(['a', 'pdf']);
    expect(ids(placeOutputs(desk, ['a', 'c'], [file('pdf', 'pdf')]))).toEqual(['pdf', 'b']);
  });
  it('一变多：原来那份留着，新的几份排在它后面', () => {
    expect(ids(placeOutputs(desk, ['a'], [file('a1'), file('a2')]))).toEqual([
      'a',
      'a1',
      'a2',
      'b',
      'c',
    ]);
  });
  it('几份各自处理（压缩三张图）：一份换一份', () => {
    expect(ids(placeOutputs(desk, ['a', 'b', 'c'], [file('x'), file('y'), file('z')]))).toEqual([
      'x',
      'y',
      'z',
    ]);
  });
  it('没有文件输出（识别文字）：桌上不变', () => {
    expect(placeOutputs(desk, ['a'], [])).toBeNull();
  });
});

describe('清理提示和读回', () => {
  it('7 天没动才提示清理（只提示，不自动删）', () => {
    const now = 100 * DAY;
    expect(isStaleDesk({ touchedAt: now - (DESK_STALE_DAYS * DAY - 1) }, now)).toBe(false);
    expect(isStaleDesk({ touchedAt: now - DESK_STALE_DAYS * DAY }, now)).toBe(true);
  });

  it('桌面的 JSON 读回来是原样；格式不对时当作没有', () => {
    const desk = deskWith(2);
    expect(parseDesk(JSON.stringify(desk))).toEqual(desk);
    expect(parseDesk('not json')).toBeNull();
    expect(parseDesk(JSON.stringify({ ...desk, version: 2 }))).toBeNull();
    expect(parseDesk(JSON.stringify({ ...desk, current: 5 }))).toBeNull();
    expect(parseDesk(JSON.stringify({ ...desk, versions: [] }))).toBeNull();
  });

  it('桌面的 JSON 只记工具的 ID，不记参数', () => {
    const desk = commitVersion(
      newDesk('d', [file('a')], 0),
      [file('b')],
      { kind: 'action', action: 'image.watermark' },
      1,
    ).desk;
    expect(JSON.stringify(desk)).not.toContain('params');
  });

  it('文件的种类：Excel、别的办公文档、图片、PDF、音视频', () => {
    expect(deskKindOf(file('a', 'xlsx'))).toBe('sheet');
    expect(deskKindOf(file('a', 'docx'))).toBe('doc');
    expect(deskKindOf({ ext: 'pptx', mimeType: 'application/octet-stream' })).toBe('doc');
    expect(deskKindOf(file('a', 'jpg'))).toBe('image');
    expect(deskKindOf(file('a', 'pdf'))).toBe('pdf');
    expect(deskKindOf({ ext: 'mov', mimeType: 'video/quicktime' })).toBe('video');
    expect(deskKindOf({ ext: 'm4a', mimeType: 'audio/mp4' })).toBe('audio');
    expect(deskKindOf({ ext: 'zip', mimeType: 'application/zip' })).toBe('other');
  });

  it('名字里没有扩展名的办公文档（Android 别的 App 分享过来常这样）：按 MIME 认出 Excel、Word', () => {
    expect(
      deskKindOf({
        ext: 'bin',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    ).toBe('sheet');
    expect(
      deskKindOf({
        ext: 'bin',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBe('doc');
    expect(deskKindOf({ ext: 'bin', mimeType: 'application/octet-stream' })).toBe('other');
  });
});
