import { currentFiles } from '@morph/core';
import type { TableDoc } from '@morph/tool-office';

import {
  dropEditDraft,
  listDesks,
  loadDesk,
  placeOnDesk,
  recoverEditDraft,
  saveDesk,
  writeEditDraft,
} from '../desk/store';
import { FakeFiles } from '../test-utils/fake-files';

// R08：桌面清单（desk.json）和没合上的编辑（editing.json）不直接覆盖原文件：先完整写 .tmp、读回来核对，
// 旧的改名成 .bak，再把 .tmp 换成正式文件。写到一半被打断，正式文件或上一份好的还读得出来，桌面不会不见。

const MAIN = 'desk/d1/desk.json';
const text = (files: FakeFiles, path: string) =>
  files.disk.has(path) ? new TextDecoder().decode(files.disk.get(path)!) : null;

async function setup() {
  const files = new FakeFiles();
  files.disk.set('content://media/photo1', new Uint8Array(30).fill(7));
  const desk = await placeOnDesk(
    files,
    [{ uri: 'content://media/photo1', name: 'a.jpg', size: 30, mimeType: 'image/jpeg' }],
    1000,
    'd1',
  );
  return { files, desk };
}

describe('桌面清单的写法', () => {
  it('正常保存：正式文件是新的，上一份留作 .bak，没有 .tmp 剩下', async () => {
    const { files, desk } = await setup();
    const before = text(files, MAIN)!;
    await saveDesk(files, { ...desk, touchedAt: 2000 });
    expect(JSON.parse(text(files, MAIN)!).touchedAt).toBe(2000);
    expect(text(files, `${MAIN}.bak`)).toBe(before);
    expect(files.disk.has(`${MAIN}.tmp`)).toBe(false);
    expect((await loadDesk(files, 'd1'))!.touchedAt).toBe(2000);
  });

  it('.tmp 没写全：保存报错，正式文件原样不动，.tmp 清掉', async () => {
    const { files, desk } = await setup();
    const before = text(files, MAIN)!;
    // 写 .tmp 时只写了一半。
    const write = files.desk.writeBytes.bind(files.desk);
    jest
      .spyOn(files.desk, 'writeBytes')
      .mockImplementation(async (path, bytes) =>
        write(path, path.endsWith('.tmp') ? bytes.slice(0, 10) : bytes),
      );
    await expect(saveDesk(files, { ...desk, touchedAt: 2000 })).rejects.toThrow(/not written/);
    expect(text(files, MAIN)).toBe(before);
    expect(files.disk.has(`${MAIN}.tmp`)).toBe(false);
    expect((await loadDesk(files, 'd1'))!.touchedAt).toBe(desk.touchedAt);
  });

  it('换上之前被打断（旧的已经改成 .bak、.tmp 还没换上）：读得出新的那份', async () => {
    const { files, desk } = await setup();
    const rename = files.desk.rename.bind(files.desk);
    let calls = 0;
    jest.spyOn(files.desk, 'rename').mockImplementation(async (from, to) => {
      if (++calls === 2) throw new Error('killed');
      return rename(from, to);
    });
    await expect(saveDesk(files, { ...desk, touchedAt: 2000 })).rejects.toThrow('killed');
    // 正式文件没了，.tmp 是写好的新清单：打开桌面时用它。
    expect(files.disk.has(MAIN)).toBe(false);
    expect((await loadDesk(files, 'd1'))!.touchedAt).toBe(2000);
    expect((await listDesks(files)).map((d) => d.id)).toEqual(['d1']);
  });

  it('正式文件被截断了（读不出来）：用上一份好的 .bak，桌面还在列表里', async () => {
    const { files, desk } = await setup();
    await saveDesk(files, { ...desk, touchedAt: 2000 });
    files.disk.set(MAIN, files.disk.get(MAIN)!.slice(0, 20));
    expect((await loadDesk(files, 'd1'))!.touchedAt).toBe(desk.touchedAt);
    expect((await listDesks(files)).map((d) => d.id)).toEqual(['d1']);
  });

  it('正式文件坏了的时候再保存：新的换上，.bak 还是上一份好的，不会被坏的盖掉', async () => {
    const { files, desk } = await setup();
    await saveDesk(files, { ...desk, touchedAt: 2000 });
    const good = text(files, `${MAIN}.bak`)!;
    files.disk.set(MAIN, files.disk.get(MAIN)!.slice(0, 20));
    await saveDesk(files, { ...desk, touchedAt: 3000 });
    expect((await loadDesk(files, 'd1'))!.touchedAt).toBe(3000);
    expect(text(files, `${MAIN}.bak`)).toBe(good);
  });

  it('别的桌面的清单放到这个桌面的位置也不算（id 对不上）', async () => {
    const { files, desk } = await setup();
    await saveDesk(files, { ...desk, touchedAt: 2000 });
    files.disk.set(MAIN, new TextEncoder().encode(JSON.stringify({ ...desk, id: 'other' })));
    // 正式文件 id 不对，退到上一份好的。
    expect((await loadDesk(files, 'd1'))!.id).toBe('d1');
  });

  it('全部都读不出来：返回 null', async () => {
    const files = new FakeFiles();
    expect(await loadDesk(files, 'nothere')).toBeNull();
  });
});

describe('没合上的编辑（editing.json）', () => {
  const doc = (n: number): { kind: 'table'; doc: TableDoc } => ({
    kind: 'table',
    doc: { v: 1, pages: [] } as unknown as TableDoc,
    ...({ n } as object),
  });

  it('合上以后不留 .tmp / .bak：删掉的编辑不会从备份里活过来', async () => {
    const { files, desk } = await setup();
    const file = currentFiles(desk)[0]!;
    await writeEditDraft(files, desk, file.id, doc(1));
    await writeEditDraft(files, desk, file.id, doc(2));
    expect(files.disk.has('desk/d1/editing.json.bak')).toBe(true);
    await dropEditDraft(files, desk);
    for (const suffix of ['', '.tmp', '.bak'])
      expect(files.disk.has(`desk/d1/editing.json${suffix}`)).toBe(false);
    // 打开房间时没有要恢复的编辑。
    expect(await recoverEditDraft(files, desk, 5000)).toBe(desk);
  });
});
