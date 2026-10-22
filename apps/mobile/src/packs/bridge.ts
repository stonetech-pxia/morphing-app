import { packById } from '@morph/core';

// App 和扩展包页面（WebView）之间的通道（D-074）。
// 页面只能拿到两种文件：已安装扩展包清单里列出的文件，和本次调用明确传入的文件。
// 消息格式固定；App 只发送动作名、我们自己的参数和文件内容，从不注入代码。

export type PackPageId = 'pdfview' | 'scan' | 'ocr';

/** 读文件的能力（App 中由 expo-file-system 实现）。 */
export interface BridgeFiles {
  /** 已安装扩展包里的文件，读成文字或 base64。 */
  packFile(pack: string, path: string, as: 'text' | 'base64'): Promise<string>;
  isInstalled(pack: string): Promise<boolean>;
  /** 本次运行的临时文件，读成 base64。 */
  runFile(uri: string): Promise<string>;
}

export interface PackRuntime {
  /** 调用扩展包页面里的一个处理函数；files 是本次允许页面读取的文件（名字 → 地址）。 */
  call<T>(
    page: PackPageId,
    method: string,
    args: Record<string, unknown>,
    files?: Record<string, string>,
  ): Promise<T>;
}

interface Poster {
  postMessage(message: string): void;
}

const CHUNK = 512 * 1024;
const READY_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 180_000;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class PackBridge implements PackRuntime {
  private webviews = new Map<PackPageId, Poster>();
  private readyWaiters = new Map<PackPageId, Pending[]>();
  private readyPages = new Set<PackPageId>();
  private pending = new Map<number, Pending>();
  private allowed = new Map<string, string>();
  private nextId = 0;
  private active: PackPageId[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly files: BridgeFiles) {}

  // ---- 给宿主组件用 ----
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  activePages = () => this.active;
  attach(page: PackPageId, webview: Poster | null) {
    if (webview) this.webviews.set(page, webview);
    else {
      this.webviews.delete(page);
      this.readyPages.delete(page);
    }
  }

  /** 页面发来的消息。 */
  async onMessage(page: PackPageId, data: string): Promise<void> {
    let m: {
      t?: string;
      id?: number;
      ok?: boolean;
      value?: unknown;
      error?: string;
      ref?: Ref;
      as?: string;
    };
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m.t === 'log') {
      // 页面里的错误只写进开发日志（内容是我们自己的页面代码报的错，不含文件内容）。
      if (__DEV__) console.warn(`[pack:${page}]`, (m as { message?: string }).message);
      return;
    }
    if (m.t === 'ready') {
      if (__DEV__) console.log(`[pack:${page}] ready`);
      this.readyPages.add(page);
      for (const w of this.readyWaiters.get(page) ?? []) w.resolve(undefined);
      this.readyWaiters.delete(page);
    } else if (m.t === 'result' && typeof m.id === 'number') {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.ok) p?.resolve(m.value);
      else {
        if (__DEV__) console.warn(`[pack:${page}] call failed`, m.error);
        p?.reject(new Error(m.error ?? 'failed'));
      }
    } else if (m.t === 'need' && typeof m.id === 'number' && m.ref) {
      await this.serve(page, m.id, m.ref, m.as === 'bytes' ? 'bytes' : 'text');
    }
  }

  async call<T>(
    page: PackPageId,
    method: string,
    args: Record<string, unknown>,
    files: Record<string, string> = {},
  ): Promise<T> {
    await this.open(page);
    for (const [name, uri] of Object.entries(files)) this.allowed.set(name, uri);
    const id = ++this.nextId;
    try {
      return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('timeout'));
        }, CALL_TIMEOUT_MS);
        this.pending.set(id, {
          resolve: (v) => (clearTimeout(timer), resolve(v as T)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        });
        this.post(page, { t: 'call', id, method, args });
      });
    } finally {
      for (const name of Object.keys(files)) this.allowed.delete(name);
    }
  }

  /** 关掉页面释放内存（例如离开运行页面后）。 */
  close(page: PackPageId) {
    this.active = this.active.filter((p) => p !== page);
    this.emit();
  }

  private async open(page: PackPageId) {
    if (this.readyPages.has(page)) return;
    if (!this.active.includes(page)) {
      this.active = [...this.active, page];
      this.emit();
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('page did not start')), READY_TIMEOUT_MS);
      const list = this.readyWaiters.get(page) ?? [];
      list.push({ resolve: () => (clearTimeout(timer), resolve()), reject });
      this.readyWaiters.set(page, list);
    });
  }

  private async serve(page: PackPageId, id: number, ref: Ref, as: 'text' | 'bytes') {
    if (__DEV__) console.log(`[pack:${page}] need`, 'pack' in ref ? ref.path : 'input file');
    try {
      let data: string;
      if ('pack' in ref) {
        // 只允许清单里列出的文件，而且扩展包必须已安装（校验过哈希）。
        const pack = packById(ref.pack);
        if (!pack || !pack.files.some((f) => f.path === ref.path)) throw new Error('not allowed');
        if (!(await this.files.isInstalled(ref.pack))) throw new Error('pack not installed');
        data = await this.files.packFile(ref.pack, ref.path, as === 'bytes' ? 'base64' : 'text');
      } else {
        const uri = this.allowed.get(ref.file);
        if (!uri) throw new Error('not allowed');
        data = await this.files.runFile(uri);
      }
      const n = Math.max(1, Math.ceil(data.length / CHUNK));
      for (let i = 0; i < n; i++) {
        this.post(page, { t: 'chunk', id, i, n, data: data.slice(i * CHUNK, (i + 1) * CHUNK) });
      }
    } catch (e) {
      if (__DEV__) console.warn(`[pack:${page}] serve failed`, String(e));
      this.post(page, { t: 'chunk', id, error: String(e instanceof Error ? e.message : e) });
    }
  }

  private post(page: PackPageId, message: unknown) {
    this.webviews.get(page)?.postMessage(JSON.stringify(message));
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

type Ref = { pack: string; path: string } | { file: string };
