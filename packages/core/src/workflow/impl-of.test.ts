import { describe, expect, it } from 'vitest';

import { AUDIO_COMPRESS_PARAMS, AUDIO_CONVERT_PARAMS, AUDIO_ACTIONS } from '../tools/audio';
import { implOf, type StepContext } from './engine';

// R14：动作的参数 schema 和实现连在一起——实现里的 params 类型是 schema 推出来的（这个文件的类型检查就是测试）。

describe('implOf', () => {
  it('passes the params through and types them from the schema', async () => {
    let seen: unknown;
    const impl = implOf(AUDIO_CONVERT_PARAMS, async (_input, params) => {
      // 类型是 'm4a' | 'wav' | 'mp3' | ...，不是 unknown。
      const format: string = params.format;
      // @ts-expect-error schema 里没有这个参数：在 core 里改了名字，实现这边编译就会报错
      void params.nothing;
      seen = format;
      return { type: 'files', items: [] };
    });
    await impl(null, { format: 'm4a' }, {} as StepContext<unknown>);
    expect(seen).toBe('m4a');
  });

  it('the definition and the implementation share one schema object', () => {
    const compress = AUDIO_ACTIONS.find((a) => a.id === 'audio.compress')!;
    const convert = AUDIO_ACTIONS.find((a) => a.id === 'audio.convert')!;
    expect(compress.params).toBe(AUDIO_COMPRESS_PARAMS);
    expect(convert.params).toBe(AUDIO_CONVERT_PARAMS);
  });
});
