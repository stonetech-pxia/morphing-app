import { packById, type PackManifest } from '@morph/core';

// 扩展包的下载、校验、存储和删除（D-064，TOOLS_DESIGN §6）。
// 存在 documentDirectory/packs/<id>/<version>/，不进版本，回滚不受影响；ready.json 写好才算安装完成，
// 所以中断的下载不会被当成已安装。文件系统和哈希由 App 注入，测试里用内存实现。

export interface PackFs {
  /** 下载到 packs 目录下的相对路径，返回下载到的字节。 */
  download(url: string, path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  /** 删除文件或整个目录（不存在时什么也不做）。 */
  remove(path: string): Promise<void>;
  /** 目录下的子目录名。 */
  listDirs(path: string): Promise<string[]>;
  /** 某个文件的绝对地址（WebView 读取用）。 */
  uri(path: string): string;
  readBytes(path: string): Promise<Uint8Array>;
}

export type Sha256 = (bytes: Uint8Array) => Promise<string>;

export class PackError extends Error {
  constructor(
    readonly code: 'unknown' | 'download' | 'hash' | 'size',
    readonly file?: string,
  ) {
    super(file ? `${code}: ${file}` : code);
  }
}

export interface InstalledPack {
  id: string;
  version: string;
  bytes: number;
  installedAt: number;
}

export interface PackProgress {
  packId: string;
  doneBytes: number;
  totalBytes: number;
}

const dirOf = (pack: PackManifest) => `${pack.id}/${pack.version}`;

/** 同时下载的文件数。 */
const PARALLEL = 6;

export class PackStore {
  constructor(
    private readonly fs: PackFs,
    private readonly sha256: Sha256,
    /** 清单查找（测试里换成测试用的清单）。 */
    private readonly lookup: (id: string) => PackManifest | undefined = packById,
    private readonly now: () => number = Date.now,
  ) {}

  async isInstalled(id: string): Promise<boolean> {
    const pack = this.lookup(id);
    return pack ? this.fs.exists(`${dirOf(pack)}/ready.json`) : false;
  }

  /** 已安装的扩展包（只算当前清单里的版本；旧版本目录会在安装新版本时删除）。 */
  async installed(): Promise<InstalledPack[]> {
    const out: InstalledPack[] = [];
    for (const id of await this.fs.listDirs('')) {
      const pack = this.lookup(id);
      if (!pack || !(await this.isInstalled(id))) continue;
      const ready = JSON.parse(await this.fs.readText(`${dirOf(pack)}/ready.json`)) as {
        bytes: number;
        installedAt: number;
      };
      out.push({ id, version: pack.version, bytes: ready.bytes, installedAt: ready.installedAt });
    }
    return out;
  }

  /**
   * 下载并校验一个扩展包（连同它依赖的扩展包）。只能由用户在界面上确认后调用（D-064）。
   * 任何一个文件的大小或 SHA-256 不对，就删除这个版本目录并报错。
   */
  async install(id: string, onProgress?: (p: PackProgress) => void): Promise<void> {
    const pack = this.lookup(id);
    if (!pack) throw new PackError('unknown', id);
    for (const dep of pack.requires ?? []) {
      if (!(await this.isInstalled(dep))) await this.install(dep, onProgress);
    }
    if (await this.isInstalled(id)) return;
    const dir = dirOf(pack);
    // 同一个扩展包的其他版本（旧版本或中断的下载）先删掉。
    await this.fs.remove(pack.id);
    const total = pack.files.reduce((sum, f) => sum + f.size, 0);
    let done = 0;
    onProgress?.({ packId: id, doneBytes: 0, totalBytes: total });
    try {
      // 同时下载几个文件（pdf.js 有一百多个小 cmap 文件，一个一个下太慢）。
      const queue = [...pack.files];
      const worker = async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          let bytes: Uint8Array;
          try {
            bytes = await this.fs.download(file.url, `${dir}/${file.path}`);
          } catch {
            throw new PackError('download', file.path);
          }
          if (bytes.length !== file.size) throw new PackError('size', file.path);
          if ((await this.sha256(bytes)) !== file.sha256) throw new PackError('hash', file.path);
          done += file.size;
          onProgress?.({ packId: id, doneBytes: done, totalBytes: total });
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, pack.files.length) }, worker));
    } catch (e) {
      await this.fs.remove(pack.id);
      throw e;
    }
    await this.fs.writeText(
      `${dir}/ready.json`,
      JSON.stringify({ id, version: pack.version, bytes: total, installedAt: this.now() }),
    );
  }

  /** 删除扩展包；删除文字识别包时一起删除各语言包（它们离开识别包用不了）。 */
  async remove(id: string): Promise<void> {
    await this.fs.remove(id);
    const dependents = (await this.fs.listDirs('')).filter((d) =>
      (this.lookup(d)?.requires ?? []).includes(id),
    );
    for (const d of dependents) await this.fs.remove(d);
  }

  /** 已安装扩展包里的一个文件。 */
  path(id: string, file: string): string {
    const pack = this.lookup(id);
    if (!pack) throw new PackError('unknown', id);
    return `${dirOf(pack)}/${file}`;
  }

  readText(id: string, file: string): Promise<string> {
    return this.fs.readText(this.path(id, file));
  }

  readBytes(id: string, file: string): Promise<Uint8Array> {
    return this.fs.readBytes(this.path(id, file));
  }
}
