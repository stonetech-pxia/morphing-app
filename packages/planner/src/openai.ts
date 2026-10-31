import type { Registry } from '@morph/core';

import { AIHttpError, type AIErrorKind } from './http';
import type { Complete, Completion, PlannerMessage } from './planner';
import { systemPromptFor } from './prompt';

// OpenAI 兼容接口（POST {baseUrl}/chat/completions）的传输层，供「自带 key」选了非 Anthropic 时使用（D-241）。
// 覆盖 OpenAI、OpenRouter、DeepSeek、Gemini 的兼容接口、Groq、Ollama、LM Studio 等。
// 只发标准字段（model、messages），不发 Anthropic 专用的思考力度和提示缓存，也不发 response_format：
// 不是每家都支持，回复一律走规划器的 JSON 解析、校验和修正。
// key 只放在 Authorization 头里发给用户填的地址，不写入日志、不出现在错误信息中；本地模型可以不填 key。

/** 常见 provider 的 Base URL，只用来帮用户填地址。 */
export const OPENAI_COMPATIBLE_PRESETS: readonly { id: string; name: string; baseUrl: string }[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  {
    id: 'gemini',
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
];

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; issue: 'invalid' | 'insecure' };

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

/**
 * 检查用户填的 Base URL：必须是 https；http 只允许本机（localhost、127.x、[::1]）。
 * 局域网 http 不允许：Android 正式包默认禁止明文请求，而且 key 会明文经过 Wi-Fi（P-042）。
 * 不用 `new URL`：React Native 的 URL 不支持 hostname。
 */
export function checkBaseUrl(raw: string): BaseUrlCheck {
  const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?(\/[^\s?#]*)?$/i.exec(
    raw.trim(),
  );
  if (!match || match[2]!.startsWith('.') || match[2]!.endsWith('.')) {
    return { ok: false, issue: 'invalid' };
  }
  const [, scheme, host, port = '', path = ''] = match;
  if (scheme!.toLowerCase() === 'http' && !LOOPBACK.test(host!)) {
    return { ok: false, issue: 'insecure' };
  }
  return {
    ok: true,
    url: `${scheme!.toLowerCase()}://${host!.toLowerCase()}${port}${path.replace(/\/+$/, '')}`,
  };
}

/** 地址里的主机名，给界面说明「发到哪里」。 */
export const hostOf = (url: string) => /^https?:\/\/([^/:]+|\[[^\]]+\])/i.exec(url)?.[1] ?? url;

interface ErrorBody {
  error?: { type?: string; code?: string | number; message?: string } | string;
}

function classify(status: number, body: ErrorBody | null): AIErrorKind {
  const error = typeof body?.error === 'object' ? body.error : undefined;
  const code = String(error?.code ?? error?.type ?? '');
  if (status === 401) return 'invalid_key';
  if (status === 402 || /insufficient_quota|billing/i.test(code)) return 'spend_limit';
  if (status === 403) return 'permission';
  if (status === 404 || code === 'model_not_found') return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status === 503 || status === 529) return 'overloaded';
  if (status >= 500) return 'server';
  return 'bad_request';
}

export interface OpenAICompatibleOptions {
  baseUrl: string;
  /** 本地模型可以没有 key。 */
  apiKey?: string | null | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function request(path: string, init: RequestInit, options: OpenAICompatibleOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await fetchImpl(`${options.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const kind = classify(response.status, body as ErrorBody | null);
      throw new AIHttpError(kind, response.status, `AI API error ${response.status} (${kind})`);
    }
    return body;
  } catch (e) {
    if (controller.signal.aborted) throw new AIHttpError('timeout', 0, 'AI API request timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

interface ChatResponse {
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: {
      content?: string | { type?: string; text?: string }[] | null;
      refusal?: string | null;
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  };
}

/** 修正重试时，上一轮的内容块（[{ type: 'text', text }]）转回字符串。 */
const toText = (content: PlannerMessage['content']) =>
  typeof content === 'string'
    ? content
    : content
        .map((b) =>
          (b as { type?: string; text?: string }).type === 'text'
            ? ((b as { text?: string }).text ?? '')
            : '',
        )
        .join('');

export interface OpenAICompletionOptions extends OpenAICompatibleOptions {
  model: string;
  registry: Registry;
}

export function createOpenAICompleter(options: OpenAICompletionOptions): Complete {
  return async (messages, system): Promise<Completion> => {
    const body = {
      model: options.model,
      messages: [
        { role: 'system', content: system ?? systemPromptFor(options.registry) },
        ...messages.map((m) => ({ role: m.role, content: toText(m.content) })),
      ],
    };
    const data = (await request(
      '/chat/completions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      options,
    )) as ChatResponse | null;
    const choice = data?.choices?.[0];
    if (!choice?.message) {
      throw new AIHttpError('bad_request', 200, 'AI API reply had no message');
    }
    const raw = choice.message.content;
    const text = (typeof raw === 'string' ? raw : toText(raw ?? []))
      // 有些推理模型（如本机跑的 DeepSeek R1、Qwen）把思考过程放在 <think> 里，和回答混在一起。
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    const refused = Boolean(choice.message.refusal) || choice.finish_reason === 'content_filter';
    return {
      text,
      // 统一成规划器认识的结束原因：拒答记为 refusal，其余原样保留。
      stopReason: refused ? 'refusal' : (choice.finish_reason ?? null),
      content: [{ type: 'text', text }],
      model: data?.model ?? options.model,
      usage: {
        inputTokens: data?.usage?.prompt_tokens ?? 0,
        outputTokens: data?.usage?.completion_tokens ?? 0,
        cacheReadTokens: data?.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
      },
    };
  };
}

/**
 * 检查地址和 key 是否可用：GET {baseUrl}/models，不消耗 token。
 * 列表里找不到所填的模型时报 not_found；各家模型 id 写法不同（Gemini 带 models/，Ollama 带 :latest），宽松比较。
 */
export async function checkOpenAICompatible(
  model: string,
  options: OpenAICompatibleOptions,
): Promise<void> {
  const data = (await request('/models', { method: 'GET' }, options)) as {
    data?: { id?: string }[];
  } | null;
  const ids = Array.isArray(data?.data) ? data.data.map((m) => m.id ?? '') : [];
  if (ids.length === 0) return;
  const found = ids.some(
    (id) => id === model || id.endsWith(`/${model}`) || id === `${model}:latest`,
  );
  if (!found) throw new AIHttpError('not_found', 200, 'model not in the provider’s list');
}
