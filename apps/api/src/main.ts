import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { serve } from '@hono/node-server';

import { createRelayRuntime, loadRootEnv } from './config';
import { createApp } from './server';

loadRootEnv();
const runtime = createRelayRuntime(process.env);
const port = Number(process.env.MORPH_API_PORT ?? 8787);
const clientToken = process.env.MORPH_CLIENT_TOKEN?.trim();
// 需求回收（D-189）：用户主动发来的需求，一行一条 JSON，追加到这个文件（默认 data/needs.jsonl）。
const needsFile = resolve(process.env.MORPH_NEEDS_FILE?.trim() || 'data/needs.jsonl');
const needs = {
  async append(entry: object) {
    await mkdir(dirname(needsFile), { recursive: true });
    await appendFile(needsFile, `${JSON.stringify(entry)}\n`, 'utf8');
  },
};
// 测试期保存请求（D-240）：只有设置了 MORPH_REQUESTS_FILE 才保存，本地开发和自建服务器默认不存。
const requestsFile = process.env.MORPH_REQUESTS_FILE?.trim();
const requests = requestsFile
  ? {
      async append(entry: object) {
        const file = resolve(requestsFile);
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
      },
    }
  : undefined;

const app = createApp({
  ...runtime,
  perMinuteLimit: Number(process.env.MORPH_PER_MINUTE_LIMIT ?? 10),
  deviceDailyUsd: Number(process.env.MORPH_DEVICE_DAILY_USD ?? 0.2),
  globalDailyUsd: Number(process.env.MORPH_GLOBAL_DAILY_USD ?? 2),
  offPlanLimit: Number(process.env.MORPH_OFF_PLAN_LIMIT ?? 5),
  ...(clientToken ? { clientToken } : {}),
  needs,
  ...(requests ? { requests } : {}),
});

// 只监听本机：对外由 Cloudflare 隧道从本机转发进来（D-131），本机不开放端口。
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
  const ai = runtime.relay
    ? `Claude (${runtime.model})`
    : '无（未配置 ANTHROPIC_API_KEY，/v1/complete 返回 503）';
  const token = clientToken ? '需要客户端令牌' : '不检查客户端令牌';
  const stored = requestsFile ? `  保存请求到 ${resolve(requestsFile)}` : '';
  console.log(`Morph API: http://127.0.0.1:${port}  AI: ${ai}  ${token}${stored}`);
});
