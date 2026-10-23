import { serve } from '@hono/node-server';

import { createAIRuntime, loadRootEnv } from './config';
import { createApp } from './server';

loadRootEnv();
const runtime = createAIRuntime(process.env);
const port = Number(process.env.MORPH_API_PORT ?? 8787);
const clientToken = process.env.MORPH_CLIENT_TOKEN?.trim();

const app = createApp({
  ...runtime,
  perMinuteLimit: Number(process.env.MORPH_PER_MINUTE_LIMIT ?? 10),
  dailyLimit: Number(process.env.MORPH_DAILY_LIMIT ?? 50),
  globalDailyLimit: Number(process.env.MORPH_GLOBAL_DAILY_LIMIT ?? 500),
  ...(clientToken ? { clientToken } : {}),
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
