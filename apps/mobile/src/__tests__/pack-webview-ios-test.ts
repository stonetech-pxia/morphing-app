/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { PackBridge } from '../packs/bridge';
import { PDFJS_POLYFILLS } from '../packs/pages/common';

// 扩展包页面（隐藏的 WebView）挂在根视图上。iOS 全屏弹出（UIModalPresentationFullScreen）时会把底下的
// 视图拿出窗口，WebView 不在窗口里，系统就把它的网页进程挂起：PDF 预览、整理页面、签名一直「装载」
// （2026-10-31 iPhone 真机：页面里的计时器一次都没跑，pdf.js 画到一半停住）。安卓的弹窗是单独的窗口，不受影响。

const SRC = join(__dirname, '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('iOS 上扩展包页面不被弹出的页面挡出窗口', () => {
  it('不透明的 Modal 都用 overFullScreen（底下的视图留在窗口里）', () => {
    const bad: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/<Modal\b[^>]*>/gs)) {
        const tag = m[0];
        if (/\btransparent\b/.test(tag)) continue;
        if (!/presentationStyle="overFullScreen"/.test(tag)) {
          bad.push(`${file.slice(SRC.length + 1)}:${text.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('路由不用 fullScreenModal', () => {
    const bad = tsxFiles(SRC).filter((file) =>
      /presentation:\s*'fullScreenModal'/.test(readFileSync(file, 'utf8')),
    );
    expect(bad.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});

describe('网页进程被系统结束', () => {
  const files = {
    packFile: async () => '',
    isInstalled: async () => true,
    runFile: async () => '',
  };

  it('正在等的调用马上失败，下次调用重新打开页面', async () => {
    const bridge = new PackBridge(files);
    const posted: string[] = [];
    bridge.attach('pdfview', { postMessage: (m) => posted.push(m) });
    await bridge.onMessage('pdfview', JSON.stringify({ t: 'ready' }));

    const call = bridge.call('pdfview', 'render', {});
    await Promise.resolve();
    expect(posted).toHaveLength(1);
    bridge.processGone('pdfview');
    await expect(call).rejects.toThrow('page stopped');
    // 页面卸下，等下次调用再挂上（重新加载）。
    expect(bridge.activePages()).toEqual([]);

    const again = bridge.call('pdfview', 'ping', {});
    await Promise.resolve();
    expect(bridge.activePages()).toEqual(['pdfview']);
    expect(posted).toHaveLength(1);
    await bridge.onMessage('pdfview', JSON.stringify({ t: 'ready' }));
    await Promise.resolve();
    const id = JSON.parse(posted[1]!).id;
    await bridge.onMessage('pdfview', JSON.stringify({ t: 'result', id, ok: true, value: 1 }));
    await expect(again).resolves.toBe(1);
  });
});

describe('扩展包页面所在的视图重新渲染', () => {
  const files = {
    packFile: async () => '',
    isInstalled: async () => true,
    runFile: async () => '',
  };

  // React 每次重新渲染（例如运行页面关闭时 close 了别的页面）都会先用 null、再用同一个 WebView 调一次 ref。
  // 页面还在用时不算掉线：下一次调用直接发，不能再等一个不会再来的 ready（真机上 PDF 预览一直转圈、30 秒后失败）。
  it('同一个 WebView 先 null 再挂上，页面仍是就绪的', async () => {
    const bridge = new PackBridge(files);
    const posted: string[] = [];
    const webview = { postMessage: (m: string) => posted.push(m) };
    bridge.attach('pdfview', webview);
    const first = bridge.call('pdfview', 'preview', {});
    await Promise.resolve();
    await bridge.onMessage('pdfview', JSON.stringify({ t: 'ready' }));
    await Promise.resolve();
    expect(posted).toHaveLength(1);

    bridge.attach('pdfview', null);
    bridge.attach('pdfview', webview);
    const second = bridge.call('pdfview', 'preview', {});
    await Promise.resolve();
    await Promise.resolve();
    expect(posted).toHaveLength(2);

    bridge.processGone('pdfview');
    await expect(first).rejects.toThrow('page stopped');
    await expect(second).rejects.toThrow('page stopped');
  });

  it('页面真的卸下（不再在用）之后，下次调用要重新等 ready', async () => {
    const bridge = new PackBridge(files);
    const posted: string[] = [];
    const webview = { postMessage: (m: string) => posted.push(m) };
    bridge.attach('pdfview', webview);
    const first = bridge.call('pdfview', 'preview', {});
    await Promise.resolve();
    await bridge.onMessage('pdfview', JSON.stringify({ t: 'ready' }));
    await Promise.resolve();
    bridge.processGone('pdfview');
    await expect(first).rejects.toThrow();
    bridge.attach('pdfview', null);
    bridge.attach('pdfview', webview);

    const again = bridge.call('pdfview', 'preview', {});
    await Promise.resolve();
    expect(posted).toHaveLength(1);
    await bridge.onMessage('pdfview', JSON.stringify({ t: 'ready' }));
    await Promise.resolve();
    expect(posted).toHaveLength(2);
    bridge.processGone('pdfview');
    await expect(again).rejects.toThrow();
  });
});

describe('pdf.js 读文字在 iOS WebView 上', () => {
  // iOS 的 WebView 里 ReadableStream 不能 for await 遍历，pdf.js 的 getTextContent 报
  // 「undefined is not a function (near '...t of e...')」（2026-10-31 iPhone 真机）。
  it('补丁让 ReadableStream 可以 for await 遍历', async () => {
    const proto = ReadableStream.prototype as unknown as Record<symbol, unknown>;
    const original = proto[Symbol.asyncIterator];
    delete proto[Symbol.asyncIterator];
    try {
      new Function(PDFJS_POLYFILLS)();
      const stream = new ReadableStream<number>({
        start(c) {
          c.enqueue(1);
          c.enqueue(2);
          c.close();
        },
      });
      const got: number[] = [];
      for await (const x of stream as unknown as AsyncIterable<number>) got.push(x);
      expect(got).toEqual([1, 2]);
    } finally {
      proto[Symbol.asyncIterator] = original;
    }
  });
});
