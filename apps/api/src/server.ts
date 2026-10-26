import { createHash, timingSafeEqual } from 'node:crypto';

import type { Completion, PlannerMessage } from '@morph/planner';
import { Hono, type Context, type Next } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

// 模型转发（D-193）：App 发来系统提示词和对话，服务器加上 key、用自己选的模型转发给 Claude，原样返回。
// 服务器不认识 schema、工具和提示词，App 怎么升级都不用改服务器；模型输出由 App 校验（§8）。
// 因为提示词由 App 给，防滥用靠：只收规划要用的请求形状、按金额限额、不像计划的回复计分封设备，
// 以及上架前的设备证明（P-024）。
// 需求回收（D-189）：AI 做不到时，用户点「把这个需求告诉我们」才把那一句话发到 /v1/needs，存进 needs。
// 测试期保存请求（D-240）：给了 requests 时，每次转发成功就把提示词、对话和回复存一条，用来找 AI 理解错的句子。

/** 转发一次：只有系统提示词和对话，其余参数（模型、输出上限、思考力度）由服务器决定。 */
export type Relay = (request: {
  system: string;
  messages: PlannerMessage[];
}) => Promise<Completion>;

/** 美元 / 百万 token。缓存写入按输入价格的 1.25 倍算。 */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

export interface ServerOptions {
  /** 没配置 ANTHROPIC_API_KEY 时为 null，/v1/complete 返回 503。 */
  relay: Relay | null;
  model: string | null;
  price: Price;
  /** 每台设备每分钟最多请求数（防止误操作或循环快速耗尽额度）。 */
  perMinuteLimit: number;
  /** 每台设备每天最多花多少美元。 */
  deviceDailyUsd: number;
  /** 所有设备合计每天最多花多少美元。令牌和设备 id 都能伪造，这才是费用的真正上限（D-132）。 */
  globalDailyUsd: number;
  /** 一台设备一天里有这么多次回复不像修改计划，当天就不再给它转发。 */
  offPlanLimit: number;
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
  /** 测试期保存请求（D-240）：不给时不保存。 */
  requests?: RequestStore;
}

/** 一次转发成功的请求：设备 id 只存哈希（和日志一样），不存原始 id 和 IP。 */
export interface RequestEntry {
  at: string;
  device: string;
  platform?: string | undefined;
  appVersion?: string | undefined;
  round: 1 | 2;
  system: string;
  messages: PlannerMessage[];
  reply: string;
  stopReason: Completion['stopReason'];
  inputTokens: number;
  outputTokens: number;
}

export interface RequestStore {
  append(entry: RequestEntry): Promise<void>;
}

export interface NeedEntry {
  at: string;
  text: string;
  locale: 'en' | 'zh' | 'fr';
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
  locale: z.enum(['en', 'zh', 'fr']),
  reason: z.enum(['unknown', 'errand', 'notInstalled']),
  ai: z.enum(['mock', 'server', 'byok']).optional(),
  platform: z.enum(['ios', 'android']).optional(),
  appVersion: z
    .string()
    .regex(/^[0-9A-Za-z.+-]{1,32}$/)
    .optional(),
});

// 只收规划要用的形状：第一次请求，或「请求、模型回复、修正」三条。用户消息只能是文字（不收图片、文件），
// 模型回复只能是它自己返回的文字和思考块。客户端不能指定模型、工具或任何其他参数。
const UserMessage = z.strictObject({
  role: z.literal('user'),
  content: z.string().min(1).max(64_000),
});
const AssistantMessage = z.strictObject({
  role: z.literal('assistant'),
  content: z
    .array(
      z.discriminatedUnion('type', [
        z.strictObject({ type: z.literal('text'), text: z.string().max(64_000) }),
        z.strictObject({
          type: z.literal('thinking'),
          thinking: z.string().max(64_000),
          signature: z.string().max(64_000),
        }),
        z.strictObject({ type: z.literal('redacted_thinking'), data: z.string().max(64_000) }),
      ]),
    )
    .min(1)
    .max(8),
});
const CompleteRequestSchema = z.strictObject({
  system: z.string().min(1).max(192_000),
  messages: z.union([
    z.tuple([UserMessage]),
    z.tuple([UserMessage, AssistantMessage, UserMessage]),
  ]),
});

/** 回复像不像一个修改计划：带字符串 kind 的 JSON 对象。和 Plan 的版本无关，只用来给滥用计分。 */
export function looksLikePlan(text: string): boolean {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const value = JSON.parse(trimmed) as unknown;
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { kind?: unknown }).kind === 'string'
    );
  } catch {
    return false;
  }
}

export const costOf = (usage: Completion['usage'], price: Price) =>
  (usage.inputTokens * price.input +
    usage.cacheWriteTokens * price.input * 1.25 +
    usage.cacheReadTokens * price.cacheRead +
    usage.outputTokens * price.output) /
  1_000_000;

// App 首次使用时生成的随机 id，只用于按设备限额。
const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;
const PLATFORM = /^(ios|android)$/;
const APP_VERSION = /^[0-9A-Za-z.+-]{1,32}$/;

const digest = (value: string) => createHash('sha256').update(value).digest();

export function createApp(options: ServerOptions) {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const tokenDigest = options.clientToken ? digest(options.clientToken) : null;
  // 每台设备最近一分钟的请求时间、当天花的钱和不像计划的回复数；只记录转发过的请求，所以大小有上限。
  let devices = new Map<string, { recent: number[]; usd: number; offPlan: number }>();
  let day = new Date(now()).toDateString();
  let dayUsd = 0;

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

  app.get('/health', (c) =>
    c.json({ ok: true, ai: options.relay ? 'claude' : 'none', model: options.model }),
  );

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
    '/v1/complete',
    requireClient,
    bodyLimit({ maxSize: 320 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
    async (c) => {
      if (!options.relay) return c.json({ error: 'ai_unavailable' }, 503);
      const deviceHeader = c.req.header('x-morph-device');
      if (deviceHeader !== undefined && !DEVICE_ID.test(deviceHeader))
        return c.json({ error: 'bad_request' }, 400);
      const t = now();
      const today = new Date(t).toDateString();
      if (today !== day) {
        day = today;
        dayUsd = 0;
        devices = new Map();
      }
      if (dayUsd >= options.globalDailyUsd) return c.json({ error: 'daily_limit' }, 429);
      const key = deviceHeader ?? 'unknown';
      const device = devices.get(key) ?? { recent: [], usd: 0, offPlan: 0 };
      if (device.offPlan >= options.offPlanLimit) return c.json({ error: 'blocked' }, 403);
      while (device.recent.length > 0 && t - device.recent[0]! > 60_000) device.recent.shift();
      if (device.recent.length >= options.perMinuteLimit)
        return c.json({ error: 'rate_limited' }, 429);
      if (device.usd >= options.deviceDailyUsd) return c.json({ error: 'daily_limit' }, 429);

      const body = CompleteRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'bad_request' }, 400);

      device.recent.push(t);
      devices.set(key, device);
      try {
        const completion = await options.relay(body.data);
        const usd = costOf(completion.usage, options.price);
        device.usd += usd;
        dayUsd += usd;
        const offPlan = completion.stopReason !== 'refusal' && !looksLikePlan(completion.text);
        if (offPlan) device.offPlan++;
        const deviceHash = digest(key).toString('hex').slice(0, 8);
        const round = body.data.messages.length === 1 ? 1 : 2;
        if (options.requests) {
          // 平台和版本格式不对就不存，不拒绝请求；保存失败只记日志，照常返回回复。
          const platform = c.req.header('x-morph-platform');
          const appVersion = c.req.header('x-morph-version');
          await options.requests
            .append({
              at: new Date(t).toISOString(),
              device: deviceHash,
              ...(platform && PLATFORM.test(platform) ? { platform } : {}),
              ...(appVersion && APP_VERSION.test(appVersion) ? { appVersion } : {}),
              round,
              system: body.data.system,
              messages: body.data.messages,
              reply: completion.text,
              stopReason: completion.stopReason,
              inputTokens: completion.usage.inputTokens,
              outputTokens: completion.usage.outputTokens,
            })
            .catch((e: unknown) => log({ event: 'request_store_error', error: String(e) }));
        }
        // 日志只记录元数据，不记录提示词、用户输入或回复；设备 id 只记哈希前 8 位。
        log({
          event: 'complete',
          device: deviceHash,
          round,
          inputTokens: completion.usage.inputTokens,
          cacheReadTokens: completion.usage.cacheReadTokens,
          outputTokens: completion.usage.outputTokens,
          usd: Number(usd.toFixed(6)),
          ...(offPlan ? { offPlan: true } : {}),
          ms: now() - t,
        });
        return c.json(completion);
      } catch (e) {
        log({ event: 'complete_error', error: String(e), ms: now() - t });
        return c.json({ error: 'ai_unavailable' }, 502);
      }
    },
  );

  return app;
}
