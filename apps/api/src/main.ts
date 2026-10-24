import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { serve } from '@hono/node-server';

import { createAIRuntime, loadRootEnv } from './config';
import { createApp } from './server';
import { watchPublishedTools } from './tools';

loadRootEnv();
const runtime = createAIRuntime(process.env);
const port = Number(process.env.MORPH_API_PORT ?? 8787);
const clientToken = process.env.MORPH_CLIENT_TOKEN?.trim();
// 下载的工具（D-177）：配置了目录地址时，启动时拉一次，之后每 15 分钟再拉。
const toolsUrl = process.env.MORPH_TOOLS_URL?.trim();
const tools = toolsUrl
  ? watchPublishedTools(runtime.registry, {
      baseUrl: toolsUrl,
      devKey: process.env.MORPH_TOOLS_DEV_KEY === '1',
      intervalMs: 15 * 60 * 1000,
      log: (line) => console.log(line),
    })
  : null;
await tools?.ready;

// 需求回收（D-189）：用户主动发来的需求，一行一条 JSON，追加到这个文件（默认 data/needs.jsonl）。
const needsFile = resolve(process.env.MORPH_NEEDS_FILE?.trim() || 'data/needs.jsonl');
const needs = {
  async append(entry: object) {
    await mkdir(dirname(needsFile), { recursive: true });
    await appendFile(needsFile, `${JSON.stringify(entry)}\n`, 'utf8');
  },
};

const app = createApp({
  ...runtime,
  perMinuteLimit: Number(process.env.MORPH_PER_MINUTE_LIMIT ?? 10),
  dailyLimit: Number(process.env.MORPH_DAILY_LIMIT ?? 50),
  globalDailyLimit: Number(process.env.MORPH_GLOBAL_DAILY_LIMIT ?? 500),
  ...(clientToken ? { clientToken } : {}),
  needs,
});

// 只监听本机：对外由 Cloudflare 隧道从本机转发进来（D-131），本机不开放端口。
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
  const ai =
    runtime.providerName === 'claude'
      ? `Claude (${runtime.model})`
      : 'mock（未配置 ANTHROPIC_API_KEY）';
  const token = clientToken ? '需要客户端令牌' : '不检查客户端令牌';
  console.log(`Morph API: http://127.0.0.1:${port}  AI: ${ai}  ${token}`);
});
