import { serve } from '@hono/node-server';

import { createAIRuntime, loadRootEnv } from './config';
import { createApp } from './server';

loadRootEnv();
const runtime = createAIRuntime(process.env);
const port = Number(process.env.MORPH_API_PORT ?? 8787);

const app = createApp({
  ...runtime,
  perMinuteLimit: Number(process.env.MORPH_PER_MINUTE_LIMIT ?? 10),
  dailyLimit: Number(process.env.MORPH_DAILY_LIMIT ?? 200),
});

// 只监听本机：开发阶段没有登录鉴权（M3 云端部分完成前不对外开放）。
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
  const ai =
    runtime.providerName === 'claude'
      ? `Claude (${runtime.model})`
      : 'mock（未配置 ANTHROPIC_API_KEY）';
  console.log(`Morph API: http://127.0.0.1:${port}  AI: ${ai}`);
});
