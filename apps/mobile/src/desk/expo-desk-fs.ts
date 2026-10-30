import { Directory, File, Paths } from 'expo-file-system';

import type { DeskFs } from './fs';

// DeskFs 的 Expo 实现：App 文档目录下的 desk/（file-room DESIGN §3 建议的位置，D-336）。

const ROOT = 'desk';

const rootDir = () => new Directory(Paths.document, ROOT);

/** 桌面目录里的一个文件；目录按需创建。 */
function fileAt(path: string, create = false): File {
  const parts = path.split('/').filter((p) => p && p !== '.' && p !== '..');
  if (parts.length === 0) throw new Error('empty desk path');
  if (create) {
    const dir = new Directory(Paths.document, ROOT, ...parts.slice(0, -1));
    dir.create({ idempotent: true, intermediates: true });
  }
  return new File(Paths.document, ROOT, ...parts);
}

async function writeBytes(path: string, bytes: Uint8Array): Promise<number> {
  const dest = fileAt(path, true);
  if (!dest.exists) dest.create();
  // write 是异步的（release-build-gotchas）：一定要等它写完。
  await dest.write(bytes);
  return bytes.length;
}

const runsUri = () => new Directory(Paths.cache, 'runs').uri;

export const expoDeskFs: DeskFs = {
  uri: (path) => fileAt(path).uri,

  isRunFile: (uri) => uri.startsWith(runsUri()),

  pathOf(uri) {
    const root = rootDir().uri;
    const base = root.endsWith('/') ? root : `${root}/`;
    return uri.startsWith(base) ? decodeURIComponent(uri.slice(base.length)) : null;
  },

  async copyIn(uri, path) {
    const dest = fileAt(path, true);
    if (dest.exists) dest.delete();
    await new File(uri).copy(dest);
    return new File(dest.uri).size;
  },

  async moveIn(uri, path) {
    const source = new File(uri);
    // 移动之前读大小：移动后新地址的 File 对象读到的可能还是 0。
    const size = source.size;
    const dest = fileAt(path, true);
    if (dest.exists) dest.delete();
    source.move(dest);
    return size;
  },

  writeText: (path, text) => writeBytes(path, new TextEncoder().encode(text)),

  writeBytes,

  async readText(path) {
    const file = fileAt(path);
    if (!file.exists) return null;
    try {
      return await file.text();
    } catch {
      return null;
    }
  },

  async remove(paths) {
    for (const path of paths) {
      try {
        const file = fileAt(path);
        if (file.exists) file.delete();
      } catch {
        // 删不掉的留着：清空桌面时和整个目录一起删。
      }
    }
  },

  async removeDesk(deskId) {
    if (!/^[a-z0-9]+$/.test(deskId)) return;
    const dir = new Directory(Paths.document, ROOT, deskId);
    if (dir.exists) dir.delete();
  },

  async list() {
    const root = rootDir();
    if (!root.exists) return [];
    return root
      .list()
      .filter((entry) => entry instanceof Directory)
      .map((entry) => entry.name);
  },
};
