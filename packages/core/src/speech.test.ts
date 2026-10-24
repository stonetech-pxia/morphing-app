import { describe, expect, it } from 'vitest';

import { packById } from './packs';
import {
  SPEECH_LANGUAGES,
  SPEECH_LANGUAGE_NAMES,
  SPEECH_MODEL_PACKS,
  SPEECH_MODELS,
  SPEECH_VAD_PACK,
  SYSTEM_SPEECH_LOCALES,
  tidyTranscript,
  whisperLanguage,
  whisperPrompt,
  type SpeechSegment,
} from './speech';

const seg = (startMs: number, endMs: number, text: string): SpeechSegment => ({
  startMs,
  endMs,
  text,
});

describe('speech languages', () => {
  it('every language has a name, a system locale and a whisper code', () => {
    for (const lang of SPEECH_LANGUAGES) {
      expect(SPEECH_LANGUAGE_NAMES[lang].zh).toBeTruthy();
      expect(SYSTEM_SPEECH_LOCALES[lang]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(whisperLanguage(lang)).toMatch(/^[a-z]{2}$/);
    }
  });

  it('Mandarin and Taiwanese Mandarin are both zh for whisper; the prompt picks the script', () => {
    expect(whisperLanguage('zh')).toBe('zh');
    expect(whisperLanguage('zh-TW')).toBe('zh');
    expect(whisperPrompt('zh')).toBe('以下是普通话的句子。');
    expect(whisperPrompt('zh-TW')).toBe('以下是國語的句子。');
    expect(whisperPrompt('en')).toBeUndefined();
  });

  it('every model is a download that brings the speech detector with it', () => {
    for (const model of SPEECH_MODELS) {
      const pack = packById(SPEECH_MODEL_PACKS[model])!;
      expect(pack.requires).toEqual([SPEECH_VAD_PACK]);
      expect(pack.files.map((f) => f.path)).toEqual(['model.bin']);
    }
    expect(packById(SPEECH_VAD_PACK)!.files.map((f) => f.path)).toEqual(['vad.bin']);
  });
});

describe('tidyTranscript', () => {
  it('joins Chinese without spaces and uses full-width punctuation', () => {
    const text = tidyTranscript(
      [
        seg(0, 4000, ' 明天上午9点在三楼会议室开会,讨论下个月的预算。'),
        seg(4000, 8000, '请大家把报销单在周五之前交给财务, 好吗?'),
      ],
      'zh',
    );
    expect(text).toBe(
      '明天上午9点在三楼会议室开会，讨论下个月的预算。请大家把报销单在周五之前交给财务，好吗？',
    );
  });

  it('keeps decimal points and times, removes stray spaces before punctuation', () => {
    expect(tidyTranscript([seg(0, 1000, '办公室9.30开门 ，停车在后面')], 'zh')).toBe(
      '办公室9.30开门，停车在后面',
    );
  });

  it('joins other languages with spaces', () => {
    expect(
      tidyTranscript(
        [seg(0, 2000, ' Hi, this is a reminder.'), seg(2000, 4000, ' Bring your passport.')],
        'en',
      ),
    ).toBe('Hi, this is a reminder. Bring your passport.');
  });

  it('starts a new paragraph after a long pause', () => {
    expect(
      tidyTranscript(
        [seg(0, 2000, '第一段。'), seg(2500, 4000, '还是第一段。'), seg(9000, 10000, '第二段。')],
        'zh',
      ),
    ).toBe('第一段。还是第一段。\n\n第二段。');
  });

  it('drops subtitle lines whisper makes up in silence and non-speech tags', () => {
    expect(
      tidyTranscript(
        [
          seg(0, 1000, '[音乐]'),
          seg(1000, 2000, '(笑)'),
          seg(2000, 5000, '今天讲光合作用。'),
          seg(5000, 6000, '字幕由Amara.org社区提供'),
          seg(6000, 7000, '请不吝点赞 订阅 转发 打赏支持明镜与点点栏目'),
          seg(7000, 8000, '...'),
        ],
        'zh',
      ),
    ).toBe('今天讲光合作用。');
    expect(
      tidyTranscript(
        [seg(0, 1000, ' Thanks for watching!'), seg(1000, 2000, '[BLANK_AUDIO]')],
        'en',
      ),
    ).toBe('');
  });

  it('does not drop a sentence that only mentions those words', () => {
    expect(tidyTranscript([seg(0, 1000, '谢谢大家今天来开会。')], 'zh')).toBe(
      '谢谢大家今天来开会。',
    );
  });

  it('leaves Korean spacing alone', () => {
    expect(tidyTranscript([seg(0, 1000, '안녕하세요, 내일 봐요.')], 'ko')).toBe(
      '안녕하세요, 내일 봐요.',
    );
  });
});
