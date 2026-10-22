import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import type { PackFs, Sha256 } from './store';

// PackFs 的 Expo 实现：documentDirectory/packs/。下载用 expo-file-system，哈希用 expo-crypto（都在 Expo Go 里）。

const root = () => new Directory(Paths.document, 'packs');

function fileAt(path: string): File {
  const parts = path.split('/');
  const dir = new Directory(root(), ...parts.slice(0, -1));
  dir.create({ idempotent: true, intermediates: true });
  return new File(dir, parts[parts.length - 1]!);
}

const entry = (path: string) => (path ? new Directory(root(), ...path.split('/')) : root());

export const expoPackFs: PackFs = {
  async download(url, path) {
    const dest = fileAt(path);
    if (dest.exists) dest.delete();
    const file = await File.downloadFileAsync(url, dest);
    return file.bytes();
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
    file.write(text);
  },

  async readBytes(path) {
    return new File(root(), ...path.split('/')).bytes();
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

  uri(path) {
    return new File(root(), ...path.split('/')).uri;
  },
};

export const expoSha256: Sha256 = async (bytes) => {
  const buffer = await digest(CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** 通道读文件：扩展包里的文件和本次运行的临时文件。 */
export function expoBridgeFiles(store: {
  isInstalled(id: string): Promise<boolean>;
  path(id: string, file: string): string;
}): import('./bridge').BridgeFiles {
  return {
    isInstalled: (pack) => store.isInstalled(pack),
    async packFile(pack, path, as) {
      const file = new File(root(), ...store.path(pack, path).split('/'));
      return as === 'text' ? file.text() : file.base64();
    },
    runFile: (uri) => new File(uri).base64(),
  };
}
