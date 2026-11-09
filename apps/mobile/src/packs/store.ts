import { packById, packFileUrl, type PackManifest } from '@morph/core';

// 扩展包的下载、校验、存储和删除（D-064，TOOLS_DESIGN §6）。
// 存在 documentDirectory/packs/<id>/<version>/，不进版本，回滚不受影响；ready.json 写好才算安装完成，
// 所以中断的下载不会被当成已安装。文件系统和哈希由 App 注入，测试里用内存实现。
// 随 App 打包的扩展包（D-510）算已安装：第一次用到时从 App 里复制过来（不联网），和下载一样校验大小和 SHA-256。

export interface PackFs {
  /** 下载到 packs 目录下的相对路径，返回下载到的字节。 */
  download(url: string, path: string): Promise<Uint8Array>;
  /**
   * 大文件（几十到几百 MB 的语音模型）：下载到磁盘，在原生代码里边读边算 SHA-256，不读进 JS 内存；
   * onBytes 报告已经下载的字节。没有时（Expo Go、测试）退回 download。
   */
  downloadLarge?(
    url: string,
    path: string,
    onBytes: (bytes: number) => void,
  ): Promise<{ size: number; sha256: string }>;
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
  /**
   * 随 App 打包的扩展包（D-510）：App 里的 packs/ 目录，结构和这里一样（<id>/<version>/<文件>），只读。
   * 返回 App 里这个目录下的子目录名；App 里没带（开发版、Expo Go、测试）时是空的。
   */
  bundledDirs?(path: string): Promise<string[]>;
  /** 把 App 里同一相对路径的文件复制到这里，返回复制后的大小和 SHA-256（原生边读边算）。 */
  copyBundled?(path: string): Promise<{ size: number; sha256: string }>;
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
  /** 从 App 里复制来的（D-510），不是下载的。 */
  bundled?: true;
}

export interface PackProgress {
  packId: string;
  doneBytes: number;
  totalBytes: number;
}

const dirOf = (pack: PackManifest) => `${pack.id}/${pack.version}`;

/** 同时下载的文件数。 */
const PARALLEL = 6;

/** 超过这个大小的文件走 downloadLarge。 */
export const LARGE_FILE = 32 * 1024 * 1024;

export class PackStore {
  constructor(
    private readonly fs: PackFs,
    private readonly sha256: Sha256,
    /** 清单查找（测试里换成测试用的清单）。 */
    private readonly lookup: (id: string) => PackManifest | undefined = packById,
    private readonly now: () => number = Date.now,
    /** 还没定托管地址的扩展包从这里下载（EXPO_PUBLIC_MORPH_PACKS_URL，D-274）。 */
    private readonly packsUrl?: string,
  ) {}

  private readonly listeners = new Set<() => void>();

  /** 装好或删掉一个扩展包时通知（页面上「要先下载」的提示跟着变，D-456）。返回取消订阅。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private changed() {
    for (const listener of [...this.listeners]) listener();
  }

  private ready(pack: PackManifest): Promise<boolean> {
    return this.fs.exists(`${dirOf(pack)}/ready.json`);
  }

  /** App 里带着清单上的这个版本（D-510）；清单换了新版本而 App 里还是旧的，就照旧下载。 */
  private async bundled(pack: PackManifest): Promise<boolean> {
    if (!this.fs.copyBundled) return false;
    return ((await this.fs.bundledDirs?.(pack.id)) ?? []).includes(pack.version);
  }

  /** 装好了，或者随 App 打包（这时先从 App 里复制过来，D-510；复制不成功就当没装）。 */
  async isInstalled(id: string): Promise<boolean> {
    const pack = this.lookup(id);
    if (!pack) return false;
    if (await this.ready(pack)) return true;
    if (!(await this.bundled(pack))) return false;
    try {
      await this.install(id, undefined, true);
      return true;
    } catch {
      return false;
    }
  }

  /** 已安装的扩展包（只算当前清单里的版本；旧版本目录会在安装新版本时删除），包括随 App 打包的（D-510）。 */
  async installed(): Promise<InstalledPack[]> {
    const out: InstalledPack[] = [];
    const ids = new Set([
      ...(await this.fs.listDirs('')),
      ...((await this.fs.bundledDirs?.('')) ?? []),
    ]);
    for (const id of ids) {
      const pack = this.lookup(id);
      if (!pack || !(await this.isInstalled(id))) continue;
      const ready = JSON.parse(await this.fs.readText(`${dirOf(pack)}/ready.json`)) as {
        bytes: number;
        installedAt: number;
        bundled?: boolean;
      };
      out.push({
        id,
        version: pack.version,
        bytes: ready.bytes,
        installedAt: ready.installedAt,
        ...(ready.bundled ? { bundled: true as const } : {}),
      });
    }
    return out;
  }

  /**
   * 下载并校验一个扩展包（连同它依赖的扩展包）。只能由用户在界面上确认后调用（D-064）。
   * 随 App 打包的先从 App 里复制（D-510）；复制出来的不对时才下载。appOnly：只从 App 里复制、不下载
   * （isInstalled 用，没经过用户确认）。任何一个文件的大小或 SHA-256 不对，就删除这个版本目录并报错。
   */
  install(id: string, onProgress?: (p: PackProgress) => void, appOnly = false): Promise<void> {
    // 同一个包正在下载时（点了「后台下载」又在别处要同一个包）不再开始第二次：第二次会把第一次
    // 下到一半的目录删掉。后来的调用接着看进度，等同一次下载结束。
    const running = this.installing.get(id);
    if (running) {
      if (onProgress) running.watchers.add(onProgress);
      return running.done;
    }
    const watchers = new Set<(p: PackProgress) => void>();
    if (onProgress) watchers.add(onProgress);
    const done = this.installNow(id, (p) => watchers.forEach((w) => w(p)), appOnly).finally(() =>
      this.installing.delete(id),
    );
    this.installing.set(id, { done, watchers });
    return done;
  }

  private readonly installing = new Map<
    string,
    { done: Promise<void>; watchers: Set<(p: PackProgress) => void> }
  >();

  private readonly backgroundListeners = new Set<(e: { ids: string[]; ok: boolean }) => void>();

  /** 点了「后台下载」的下载结束时通知（成功或失败）。返回取消订阅。 */
  onBackgroundEnd(listener: (e: { ids: string[]; ok: boolean }) => void): () => void {
    this.backgroundListeners.add(listener);
    return () => void this.backgroundListeners.delete(listener);
  }

  finishedInBackground(ids: string[], ok: boolean) {
    for (const listener of [...this.backgroundListeners]) listener({ ids, ok });
  }

  private async installNow(
    id: string,
    onProgress: ((p: PackProgress) => void) | undefined,
    appOnly: boolean,
  ): Promise<void> {
    const pack = this.lookup(id);
    if (!pack) throw new PackError('unknown', id);
    for (const dep of pack.requires ?? []) {
      if (!(await this.isInstalled(dep))) await this.install(dep, onProgress, appOnly);
    }
    if (await this.ready(pack)) return;
    // 随 App 打包的（D-510）：从 App 里复制，不联网；校验和下载的一样。
    if (await this.bundled(pack)) {
      try {
        return await this.put(pack, true, onProgress);
      } catch (e) {
        // 复制出来的不对：用户确认过的照旧下载，没确认过的不下载。
        if (appOnly) throw e;
      }
    } else if (appOnly) {
      throw new PackError('download', id);
    }
    await this.put(pack, false, onProgress);
  }

  /** 把一个扩展包的文件全部放好（从 App 里复制或下载），逐个校验，最后写 ready.json。 */
  private async put(
    pack: PackManifest,
    fromApp: boolean,
    onProgress?: (p: PackProgress) => void,
  ): Promise<void> {
    const id = pack.id;
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
          const path = `${dir}/${file.path}`;
          const url = fromApp ? null : packFileUrl(file, this.packsUrl);
          if (!fromApp && !url) throw new PackError('download', file.path);
          let got: { size: number; sha256: string | null; bytes?: Uint8Array };
          try {
            if (fromApp) {
              got = await this.fs.copyBundled!(path);
            } else if (file.size > LARGE_FILE && this.fs.downloadLarge) {
              got = await this.fs.downloadLarge(url!, path, (bytes) =>
                onProgress?.({
                  packId: id,
                  doneBytes: done + Math.min(bytes, file.size),
                  totalBytes: total,
                }),
              );
            } else {
              const bytes = await this.fs.download(url!, path);
              got = { size: bytes.length, sha256: null, bytes };
            }
          } catch {
            throw new PackError('download', file.path);
          }
          if (got.size !== file.size) throw new PackError('size', file.path);
          const hash = got.sha256 ?? (await this.sha256(got.bytes!));
          if (hash !== file.sha256) throw new PackError('hash', file.path);
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
      JSON.stringify({
        id,
        version: pack.version,
        bytes: total,
        installedAt: this.now(),
        ...(fromApp ? { bundled: true } : {}),
      }),
    );
    this.changed();
  }

  /** 删除扩展包；删除文字识别包时一起删除各语言包（它们离开识别包用不了）。 */
  async remove(id: string): Promise<void> {
    await this.fs.remove(id);
    const dependents = (await this.fs.listDirs('')).filter((d) =>
      (this.lookup(d)?.requires ?? []).includes(id),
    );
    for (const d of dependents) await this.fs.remove(d);
    this.changed();
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
