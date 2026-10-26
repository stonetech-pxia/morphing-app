import { Directory, File, Paths } from 'expo-file-system';

import type { ToolFs } from './store';

// ToolFs 的 Expo 实现：documentDirectory/tools/。目录和清单都很小，直接用 fetch 读进内存。

const root = () => new Directory(Paths.document, 'tools');

function fileAt(path: string): File {
  const parts = path.split('/');
  const dir = new Directory(root(), ...parts.slice(0, -1));
  dir.create({ idempotent: true, intermediates: true });
  return new File(dir, parts[parts.length - 1]!);
}

const entry = (path: string) => (path ? new Directory(root(), ...path.split('/')) : root());

export const expoToolFs: ToolFs = {
  async fetch(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },

  async exists(path) {
    return new File(root(), ...path.split('/')).exists;
  },

  async readText(path) {
    return new File(root(), ...path.split('/')).text();
  },

  async writeText(path, text) {
    const file = fileAt(path);
    if (file.exists) file.delete();
    file.create();
    await file.write(text);
  },

  async remove(path) {
    const file = new File(root(), ...path.split('/'));
    if (path && file.exists) {
      file.delete();
      return;
    }
    const dir = entry(path);
    if (dir.exists) dir.delete();
  },

  async listDirs(path) {
    const dir = entry(path);
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((e): e is Directory => e instanceof Directory)
      .map((d) => d.name);
  },
};
