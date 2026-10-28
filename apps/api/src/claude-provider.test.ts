import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { createBatchRelay } from './claude-provider';

function message(text: string): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

/** 假的批处理接口：记下提交的批次，第二次查询才结束，结果倒序返回。 */
function fakeClient(results: (requests: { custom_id: string }[]) => unknown[]) {
  const created: { custom_id: string; params: Record<string, unknown> }[][] = [];
  let polls = 0;
  const client = {
    beta: {
      messages: {
        batches: {
          create: async ({ requests }: { requests: (typeof created)[number] }) => {
            created.push(requests);
            return { id: `batch_${created.length}`, processing_status: 'in_progress' };
          },
          retrieve: async (id: string) => ({
            id,
            processing_status: ++polls >= 2 ? 'ended' : 'in_progress',
          }),
          results: async () => results(created.at(-1)!).reverse(),
        },
      },
    },
  } as unknown as Anthropic;
  return { client, created };
}

const request = (text: string) => ({
  system: 'sys',
  messages: [{ role: 'user' as const, content: text }],
});

describe('createBatchRelay', () => {
  it('把同时到达的请求合成一批，按 custom_id 对回结果，不加 fallbacks', async () => {
    const { client, created } = fakeClient((requests) =>
      requests.map((r) => ({
        custom_id: r.custom_id,
        result: { type: 'succeeded', message: message(`回复 ${r.custom_id}`) },
      })),
    );
    const relay = createBatchRelay(
      client,
      { model: 'claude-opus-5-5', maxTokens: 1000, effort: 'low' },
      { idleMs: 0, pollMs: 0 },
    );

    const [a, b] = await Promise.all([relay(request('一')), relay(request('二'))]);

    expect(created).toHaveLength(1);
    expect(created[0]).toHaveLength(2);
    expect(created[0]![0]!.params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1000,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: '一' }],
    });
    expect(created[0]![0]!.params).not.toHaveProperty('fallbacks');
    expect(created[0]![0]!.params).not.toHaveProperty('betas');
    expect(a.text).toBe('回复 0');
    expect(b.text).toBe('回复 1');
    expect(a.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
    });
  });

  it('出错或缺失的结果让对应请求失败，不影响其他请求', async () => {
    const { client } = fakeClient(() => [
      { custom_id: '0', result: { type: 'errored', error: { type: 'overloaded_error' } } },
    ]);
    const relay = createBatchRelay(
      client,
      { model: 'claude-haiku-5-5', maxTokens: 1000 },
      { idleMs: 0, pollMs: 0 },
    );

    const [a, b] = await Promise.allSettled([relay(request('一')), relay(request('二'))]);

    expect(a).toMatchObject({
      status: 'rejected',
      reason: { message: expect.stringContaining('overloaded_error') },
    });
    expect(b).toMatchObject({
      status: 'rejected',
      reason: { message: '批处理结果里没有这个请求' },
    });
  });
});
