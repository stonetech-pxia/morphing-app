import { validateWorkspace, type AIProvider, type Registry } from '@morph/core';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

// 计划服务（M3）：App 把用户的一句话和当前配置发过来，服务端调用模型，返回计划。
// 服务端只负责生成计划，不保存任何数据；App 端仍会重新校验计划。

export interface ServerOptions {
  provider: AIProvider;
  providerName: 'claude' | 'mock';
  model: string | null;
  registry: Registry;
  /** 每分钟最多请求数（防止误操作或循环快速耗尽额度）。 */
  perMinuteLimit: number;
  /** 每天最多请求数。 */
  dailyLimit: number;
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
}

const PlanRequestSchema = z.strictObject({
  input: z.string().trim().min(1).max(500),
  locale: z.enum(['en', 'zh']),
  config: z.unknown(),
});

export function createApp(options: ServerOptions) {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const recent: number[] = [];
  let day = new Date(now()).toDateString();
  let dayCount = 0;

  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, ai: options.providerName, model: options.model }));

  app.post(
    '/v1/plan',
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
    async (c) => {
      const t = now();
      while (recent.length > 0 && t - recent[0]! > 60_000) recent.shift();
      if (recent.length >= options.perMinuteLimit) return c.json({ error: 'rate_limited' }, 429);
      const today = new Date(t).toDateString();
      if (today !== day) {
        day = today;
        dayCount = 0;
      }
      if (dayCount >= options.dailyLimit) return c.json({ error: 'daily_limit' }, 429);

      const body = PlanRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'bad_request' }, 400);
      const valid = validateWorkspace(body.data.config, options.registry);
      if (!valid.ok) return c.json({ error: 'invalid_config' }, 400);

      recent.push(t);
      dayCount++;
      try {
        const plan = await options.provider.plan(body.data.input, {
          config: valid.config,
          registry: options.registry,
          locale: body.data.locale,
        });
        // 日志只记录元数据，不记录用户输入或配置内容。
        log({
          event: 'plan',
          ai: options.providerName,
          kind: plan.kind,
          inputChars: body.data.input.length,
          ms: now() - t,
        });
        return c.json({ plan });
      } catch (e) {
        log({ event: 'plan_error', ai: options.providerName, error: String(e), ms: now() - t });
        return c.json({ error: 'ai_unavailable' }, 502);
      }
    },
  );

  return app;
}
