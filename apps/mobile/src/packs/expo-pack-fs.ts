import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import MorphSpeech from '../../modules/morph-speech';
import { PackStore, type PackFs, type Sha256 } from './store';

// PackFs 的 Expo 实现：documentDirectory/packs/。下载用 expo-file-system，哈希用 expo-crypto（都在 Expo Go 里）。
// 大文件（语音模型）的哈希由原生模块 MorphSpeech 边读边算（没有它时退回整份读进来算）。
// 随 App 打包的扩展包（D-510）在 App 里的 packs/ 下：iOS 是 .app 里的文件夹，Android 是 APK 的 assets（asset:///packs/）。

const root = () => new Directory(Paths.document, 'packs');
const bundle = () => new Directory(Paths.bundle, 'packs');

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

  ...(MorphSpeech && {
    async downloadLarge(url: string, path: string, onBytes: (bytes: number) => void) {
      const dest = fileAt(path);
      if (dest.exists) dest.delete();
      const file = await File.downloadFileAsync(url, dest, {
        onProgress: ({ bytesWritten }) => onBytes(bytesWritten),
      });
      return { size: file.size, sha256: await MorphSpeech!.sha256File(file.uri) };
    },
  }),

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

  async bundledDirs(path) {
    // 读不到 App 里的目录时当作没带：照旧提示下载，不让「装好了没有」整个出错。
    try {
      const dir = path ? new Directory(bundle(), ...path.split('/')) : bundle();
      if (!dir.exists) return [];
      return dir
        .list()
        .filter((e): e is Directory => e instanceof Directory)
        .map((d) => d.name);
    } catch (e) {
      if (__DEV__) console.warn('[packs] cannot read bundled packs', e);
      return [];
    }
  },

  async copyBundled(path) {
    const dest = fileAt(path);
    if (dest.exists) dest.delete();
    await new File(bundle(), ...path.split('/')).copy(dest);
    return { size: dest.size, sha256: await dest.digest('SHA-256') };
  },
};

export const expoSha256: Sha256 = async (bytes) => {
  const buffer = await digest(CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * App 里唯一的 PackStore：根布局（下载）、文字识别、展平、版面和语音转文字共用。随 App 打包的扩展包在第一次用到时
 * 从 App 里复制（D-510），两个 PackStore 同时复制同一个会互相删掉对方复制了一半的文件，所以只能有一个。
 * 只在用户确认后下载，存在 documentDirectory/packs（D-064）；还没定托管地址的扩展包（展平、版面，D-274）
 * 从 EXPO_PUBLIC_MORPH_PACKS_URL 下载，没配置时不提示下载。
 */
export const expoPackStore = new PackStore(
  expoPackFs,
  expoSha256,
  undefined,
  undefined,
  process.env.EXPO_PUBLIC_MORPH_PACKS_URL,
);

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
