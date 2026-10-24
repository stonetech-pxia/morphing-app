import type { Registry } from '@morph/core';

import { supportsServerFallback } from './models';
import type { Complete, Completion } from './planner';
import { systemPromptFor } from './prompt';

// 直接调用 Claude HTTP API 的传输层，供 App 内“自带 API key”模式使用。
// 官方 TypeScript SDK 目前不支持 React Native，因此 App 端用 fetch；服务端仍用 SDK。
// key 只放在请求头里发给 api.anthropic.com，不写入日志、不出现在错误信息中。

export const ANTHROPIC_API_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

export type ClaudeErrorKind =
  | 'invalid_key'
  | 'permission'
  | 'spend_limit'
  | 'rate_limit'
  | 'overloaded'
  | 'not_found'
  | 'bad_request'
  | 'server'
  | 'timeout';

export class ClaudeHttpError extends Error {
  constructor(
    readonly kind: ClaudeErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ErrorBody {
  error?: { type?: string; message?: string; details?: { error_code?: string } };
}

function classify(status: number, body: ErrorBody | null): ClaudeErrorKind {
  const type = body?.error?.type;
  const message = body?.error?.message ?? '';
  if (status === 401 || type === 'authentication_error') return 'invalid_key';
  if (status === 403 || type === 'permission_error') return 'permission';
  if (body?.error?.details?.error_code === 'enforced_spend_limit_reached') return 'spend_limit';
  if (status === 400 && /usage limits/i.test(message)) return 'spend_limit';
  if (status === 429) return 'rate_limit';
  if (status === 529 || type === 'overloaded_error') return 'overloaded';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  return 'bad_request';
}

export interface HttpOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

async function request(
  path: string,
  init: RequestInit & { headers: Record<string, string> },
  options: HttpOptions,
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
  try {
    const response = await fetchImpl(`${options.baseUrl ?? ANTHROPIC_API_URL}${path}`, {
      ...init,
      headers: {
        'x-api-key': options.apiKey,
        'anthropic-version': API_VERSION,
        ...init.headers,
      },
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const kind = classify(response.status, body as ErrorBody | null);
      throw new ClaudeHttpError(
        kind,
        response.status,
        `Claude API error ${response.status} (${kind})`,
      );
    }
    return body;
  } catch (e) {
    if (controller.signal.aborted)
      throw new ClaudeHttpError('timeout', 0, 'Claude API request timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export interface HttpCompleterOptions extends HttpOptions {
  model: string;
  registry: Registry;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined;
}

interface MessageResponse {
  content: { type: string; text?: string }[];
  stop_reason: string | null;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

export function createHttpCompleter(options: HttpCompleterOptions): Complete {
  const fallback = supportsServerFallback(options.model);
  return async (messages): Promise<Completion> => {
    const body = {
      model: options.model,
      max_tokens: 16000,
      // 系统提示词稳定不变，标记缓存以降低重复请求的成本。
      system: [
        {
          type: 'text',
          text: systemPromptFor(options.registry),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages,
      ...(options.effort ? { output_config: { effort: options.effort } } : {}),
      ...(fallback ? { fallbacks: 'default' } : {}),
    };
    const data = (await request(
      '/v1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
        },
        body: JSON.stringify(body),
      },
      options,
    )) as MessageResponse;
    return {
      text: data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(''),
      stopReason: data.stop_reason,
      content: data.content,
      model: data.model,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        cacheReadTokens: data.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: data.usage.cache_creation_input_tokens ?? 0,
      },
    };
  };
}

/** 检查 key 是否可用且能访问该模型。使用 Models API，不消耗 token。 */
export async function checkModelAccess(model: string, options: HttpOptions): Promise<void> {
  await request(`/v1/models/${encodeURIComponent(model)}`, { method: 'GET', headers: {} }, options);
}
