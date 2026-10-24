import { createHash, timingSafeEqual } from 'node:crypto';

import { PlanAboutSchema, validateWorkspace, type AIProvider, type Registry } from '@morph/core';
import { Hono, type Context, type Next } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

// 计划服务（M3）：App 把用户的一句话和当前配置发过来，服务端调用模型，返回计划。
// 生成计划时不保存任何数据；App 端仍会重新校验计划。
// 需求回收（D-189）：AI 做不到时，用户点「把这个需求告诉我们」才把那一句话发到 /v1/needs，存进 needs。

export interface ServerOptions {
  provider: AIProvider;
  providerName: 'claude' | 'mock';
  model: string | null;
  registry: Registry;
  /** 每台设备每分钟最多请求数（防止误操作或循环快速耗尽额度）。 */
  perMinuteLimit: number;
  /** 每台设备每天最多请求数。 */
  dailyLimit: number;
  /** 所有设备合计每天最多请求数。令牌和设备 id 都能伪造，这才是费用的真正上限（D-132）。 */
  globalDailyLimit: number;
  /** 设置后，请求必须带 x-morph-client 头。登录鉴权上线前的临时防护（D-132）。 */
  clientToken?: string;
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
  /** 需求回收（D-189）：保存用户主动发来的需求；不给时 /v1/needs 返回 503。 */
  needs?: NeedStore;
  /** 每台设备每天最多发几条需求。 */
  needsPerDeviceLimit?: number;
  /** 所有设备合计每天最多收几条需求。 */
  needsDailyLimit?: number;
}

/** 一条需求：只有这句话和几项没有身份信息的元数据（不存设备 id、IP、配置）。 */
export interface NeedEntry {
  at: string;
  text: string;
  locale: 'en' | 'zh';
  reason: string;
  /** 用的是哪种 AI：mock（内置规则）、server、byok。内置规则听不懂的句子很多是规则本身的限制。 */
  ai?: string | undefined;
  platform?: string | undefined;
  appVersion?: string | undefined;
}

export interface NeedStore {
  append(entry: NeedEntry): Promise<void>;
}

const NeedRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(500),
  locale: z.enum(['en', 'zh']),
  reason: z.enum(['unknown', 'errand', 'notInstalled']),
  ai: z.enum(['mock', 'server', 'byok']).optional(),
  platform: z.enum(['ios', 'android']).optional(),
  appVersion: z
    .string()
    .regex(/^[0-9A-Za-z.+-]{1,32}$/)
    .optional(),
});

const PlanRequestSchema = z.strictObject({
  input: z.string().trim().min(1).max(500),
  locale: z.enum(['en', 'zh']),
  config: z.unknown(),
  about: PlanAboutSchema.optional(),
});

// App 首次使用时生成的随机 id，只用于按设备限额。
const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;

const digest = (value: string) => createHash('sha256').update(value).digest();

export function createApp(options: ServerOptions) {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const tokenDigest = options.clientToken ? digest(options.clientToken) : null;
  // 每台设备最近一分钟的请求时间和当天的请求数；只记录被接受的请求，所以大小不超过全局上限。
  let devices = new Map<string, { recent: number[]; count: number }>();
  let day = new Date(now()).toDateString();
  let dayCount = 0;

  const app = new Hono();

  const requireClient = async (c: Context, next: Next) => {
    if (tokenDigest && !timingSafeEqual(digest(c.req.header('x-morph-client') ?? ''), tokenDigest))
      return c.json({ error: 'unauthorized' }, 401);
    await next();
  };

  // 需求的计数：只按设备 id 限次数，不写进存储。
  let needDay = new Date(now()).toDateString();
  let needCount = 0;
  let needDevices = new Map<string, number>();

  app.get('/health', (c) => c.json({ ok: true, ai: options.providerName, model: options.model }));

  app.post(
    '/v1/needs',
    requireClient,
    bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
    async (c) => {
      if (!options.needs) return c.json({ error: 'not_collecting' }, 503);
      const deviceHeader = c.req.header('x-morph-device');
      if (deviceHeader !== undefined && !DEVICE_ID.test(deviceHeader))
        return c.json({ error: 'bad_request' }, 400);
      const t = now();
      const today = new Date(t).toDateString();
      if (today !== needDay) {
        needDay = today;
        needCount = 0;
        needDevices = new Map();
      }
      const device = deviceHeader ?? 'unknown';
      if (needCount >= (options.needsDailyLimit ?? 2000))
        return c.json({ error: 'daily_limit' }, 429);
      if ((needDevices.get(device) ?? 0) >= (options.needsPerDeviceLimit ?? 20))
        return c.json({ error: 'daily_limit' }, 429);
      const body = NeedRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'bad_request' }, 400);
      needDevices.set(device, (needDevices.get(device) ?? 0) + 1);
      needCount++;
      try {
        await options.needs.append({ at: new Date(t).toISOString(), ...body.data });
      } catch (e) {
        log({ event: 'need_error', error: String(e) });
        return c.json({ error: 'store_failed' }, 500);
      }
      log({ event: 'need', reason: body.data.reason, chars: body.data.text.length });
      return c.json({ ok: true });
    },
  );

  app.post(
    '/v1/plan',
    requireClient,
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
    async (c) => {
      const deviceHeader = c.req.header('x-morph-device');
      if (deviceHeader !== undefined && !DEVICE_ID.test(deviceHeader))
        return c.json({ error: 'bad_request' }, 400);
      const t = now();
      const today = new Date(t).toDateString();
      if (today !== day) {
        day = today;
        dayCount = 0;
        devices = new Map();
      }
      if (dayCount >= options.globalDailyLimit) return c.json({ error: 'daily_limit' }, 429);
      const device = devices.get(deviceHeader ?? 'unknown') ?? { recent: [], count: 0 };
      while (device.recent.length > 0 && t - device.recent[0]! > 60_000) device.recent.shift();
      if (device.recent.length >= options.perMinuteLimit)
        return c.json({ error: 'rate_limited' }, 429);
      if (device.count >= options.dailyLimit) return c.json({ error: 'daily_limit' }, 429);

      const body = PlanRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'bad_request' }, 400);
      const valid = validateWorkspace(body.data.config, options.registry);
      if (!valid.ok) return c.json({ error: 'invalid_config' }, 400);

      device.recent.push(t);
      device.count++;
      devices.set(deviceHeader ?? 'unknown', device);
      dayCount++;
      try {
        const plan = await options.provider.plan(body.data.input, {
          config: valid.config,
          registry: options.registry,
          locale: body.data.locale,
          ...(body.data.about ? { about: body.data.about } : {}),
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
