import {
  ToolDownloadError,
  compareVersions,
  decodeUtf8,
  parseToolManifest,
  toolManifestUrl,
  verifyCatalog,
  HOST_API,
  type Catalog,
  type CatalogEntry,
  type Registry,
  type ToolManifest,
} from '@morph/core';

// 下载的工具（D-177、D-178，docs/TOOL_DOWNLOAD_DESIGN.md §4、§5）：目录和清单存在 documentDirectory/tools/。
//   catalog.json + catalog.sig   上次验证通过的目录（每次读出来都再验一遍签名）
//   <id>/<version>/manifest.json  验证过的清单；ready.json 写好才算下载完成
// 文件系统、哈希和网络由 App 注入，测试里用内存实现。

export interface ToolFs {
  /** 从网络读一个文件（不写磁盘）。 */
  fetch(url: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  listDirs(path: string): Promise<string[]>;
}

export type Sha256 = (bytes: Uint8Array) => Promise<string>;

export interface DownloadedTool {
  manifest: ToolManifest;
  bytes: number;
  downloadedAt: number;
}

// Hermes 有 TextEncoder，但不一定有 TextDecoder：解码用 core 的 decodeUtf8。
const encoder = new TextEncoder();

export class ToolDownloadStore {
  constructor(
    private readonly fs: ToolFs,
    private readonly sha256: Sha256,
    private readonly options: {
      /** 目录所在的地址（不含 catalog.json）。 */
      baseUrl: string;
      trustedKeys: readonly string[];
      now?: () => number;
    },
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  /** 上次验证通过的目录；没有、或者签名对不上（被改过）时返回 null。 */
  async cachedCatalog(): Promise<{ catalog: Catalog; checkedAt: number } | null> {
    if (!(await this.fs.exists('catalog.json')) || !(await this.fs.exists('catalog.sig'))) {
      return null;
    }
    try {
      const sig = JSON.parse(await this.fs.readText('catalog.sig')) as {
        signature: string;
        checkedAt: number;
      };
      const catalog = verifyCatalog(
        encoder.encode(await this.fs.readText('catalog.json')),
        sig.signature,
        this.options.trustedKeys,
      );
      return { catalog, checkedAt: sig.checkedAt };
    } catch {
      return null;
    }
  }

  /** 从服务器拉目录、验签名；比上次看到的旧就拒绝（防止拿旧目录撤掉停用）。 */
  async refreshCatalog(): Promise<Catalog> {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    let data: Uint8Array;
    let signature: string;
    try {
      [data, signature] = await Promise.all([
        this.fs.fetch(`${base}/catalog.json`),
        this.fs.fetch(`${base}/catalog.sig`).then((b) => decodeUtf8(b)),
      ]);
    } catch {
      throw new ToolDownloadError('download', 'catalog');
    }
    const previous = await this.cachedCatalog();
    const catalog = verifyCatalog(
      data,
      signature,
      this.options.trustedKeys,
      previous?.catalog.seq ?? 0,
    );
    await this.fs.writeText('catalog.json', decodeUtf8(data));
    await this.fs.writeText(
      'catalog.sig',
      JSON.stringify({ signature: signature.trim(), checkedAt: this.now() }),
    );
    return catalog;
  }

  /** 本机已下载的工具（每个只有一个版本）。读不出来的跳过。 */
  async downloaded(): Promise<DownloadedTool[]> {
    const out: DownloadedTool[] = [];
    for (const id of await this.fs.listDirs('')) {
      for (const version of await this.fs.listDirs(id)) {
        const dir = `${id}/${version}`;
        if (!(await this.fs.exists(`${dir}/ready.json`))) continue;
        try {
          const ready = JSON.parse(await this.fs.readText(`${dir}/ready.json`)) as {
            bytes: number;
            downloadedAt: number;
          };
          const manifest = JSON.parse(
            await this.fs.readText(`${dir}/manifest.json`),
          ) as ToolManifest;
          out.push({ manifest, bytes: ready.bytes, downloadedAt: ready.downloadedAt });
        } catch {
          // 坏掉的目录当作没下载。
        }
      }
    }
    return out;
  }

  /**
   * 下载目录里的一个工具：大小和 SHA-256 要和目录一致，清单要通过 core 的检查（parseToolManifest），
   * 不能比本机已有的版本旧。只能由用户在界面上点了才调用（D-064）。
   */
  async download(entry: CatalogEntry, registry: Registry): Promise<DownloadedTool> {
    if (entry.hostApi > HOST_API)
      throw new ToolDownloadError('host', `${entry.id} needs a newer app`);
    const current = (await this.downloaded()).find((d) => d.manifest.id === entry.id);
    if (current && compareVersions(entry.version, current.manifest.version) < 0) {
      throw new ToolDownloadError('downgrade', `${entry.id} ${entry.version}`);
    }
    if (current?.manifest.version === entry.version) return current;
    let data: Uint8Array;
    try {
      data = await this.fs.fetch(toolManifestUrl(this.options.baseUrl, entry));
    } catch {
      throw new ToolDownloadError('download', entry.id);
    }
    if (data.length !== entry.size) throw new ToolDownloadError('size', entry.id);
    if ((await this.sha256(data)) !== entry.sha256) throw new ToolDownloadError('hash', entry.id);
    const manifest = parseToolManifest(data, registry, entry);
    // 先写好新版本，再删掉旧版本：中途断了，旧版本还在。
    const dir = `${entry.id}/${entry.version}`;
    await this.fs.remove(dir);
    await this.fs.writeText(`${dir}/manifest.json`, decodeUtf8(data));
    const downloadedAt = this.now();
    await this.fs.writeText(
      `${dir}/ready.json`,
      JSON.stringify({ bytes: data.length, downloadedAt }),
    );
    for (const version of await this.fs.listDirs(entry.id)) {
      if (version !== entry.version) await this.fs.remove(`${entry.id}/${version}`);
    }
    return { manifest, bytes: data.length, downloadedAt };
  }

  /** 删掉本机下载的工具（配置里已经添加的，界面上先要移除才能删）。 */
  async remove(id: string): Promise<void> {
    await this.fs.remove(id);
  }
}
