import { describe, expect, it } from 'vitest';

import { parseStepPhrase, stepsFrom } from './ai/workflow-phrases';
import {
  MAX_SPEAK_CHARS,
  SPEAK_LANGUAGES,
  SPEAK_SEGMENT_CHARS,
  SPEAK_VOICE_LOCALES,
  chooseSpeakLanguage,
  estimateSpeechBytes,
  speakLanguageFor,
  splitForSpeech,
} from './speak';
import { registry } from './test-helpers';
import { AUDIO_ACTIONS, audioWorkflows } from './tools/audio';
import { workflowProblems } from './workflow/check';
import { presetById, presetWorkflow } from './workflows/presets';

// 文字转语音（D-270）：参数、分段、自动选语言，以及预设和步骤说法接得上。

const action = AUDIO_ACTIONS.find((a) => a.id === 'audio.fromText')!;

describe('audio.fromText params', () => {
  it('takes text and gives audio', () => {
    expect(action.input).toEqual(['text']);
    expect(action.output).toBe('audio');
  });

  it('accepts auto or a known language, a rate of 0.5–2 and M4A or WAV', () => {
    const ok = (params: unknown) => action.params.safeParse(params).success;
    expect(ok({ lang: 'auto', rate: 1, format: 'm4a' })).toBe(true);
    expect(ok({ lang: 'ja', rate: 0.5, format: 'wav' })).toBe(true);
    expect(ok({ lang: 'zh-Hant', rate: 2, format: 'm4a' })).toBe(true);
    expect(ok({ lang: 'klingon', rate: 1, format: 'm4a' })).toBe(false);
    expect(ok({ lang: 'en', rate: 0.4, format: 'm4a' })).toBe(false);
    expect(ok({ lang: 'en', rate: 2.1, format: 'm4a' })).toBe(false);
    // MP3 要再编码一遍，朗读用不着；要 MP3 可以接「音频转格式」。
    expect(ok({ lang: 'en', rate: 1, format: 'mp3' })).toBe(false);
    expect(ok({ lang: 'en', rate: 1 })).toBe(false);
    expect(ok({ lang: 'en', rate: 1, format: 'm4a', voice: 'Siri' })).toBe(false);
  });

  it('has a voice locale for every language and a field option for each', () => {
    for (const lang of SPEAK_LANGUAGES)
      expect(SPEAK_VOICE_LOCALES[lang]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    const options = action.fields.find((f) => f.key === 'lang')!.options!.map((o) => o.value);
    expect(options).toEqual(['auto', ...SPEAK_LANGUAGES]);
    const format = action.fields.find((f) => f.key === 'format')!.options!.map((o) => o.value);
    expect(format).toEqual(['m4a', 'wav']);
  });
});

describe('splitForSpeech', () => {
  it('joins the lines of a wrapped sentence so the voice does not pause mid-sentence', () => {
    const text =
      'Your lease for the apartment at 12 Elm Street will\nexpire on April 15, 2026. Please let us know\nwhether you plan to renew it.';
    expect(splitForSpeech(text)).toEqual([
      'Your lease for the apartment at 12 Elm Street will expire on April 15, 2026. Please let us know whether you plan to renew it.',
    ]);
  });

  it('keeps paragraphs apart with a blank line and packs short ones into one segment', () => {
    expect(splitForSpeech('第一章\n\n今天天气很好。\n我们去公园。\n\n完')).toEqual([
      '第一章\n\n今天天气很好。\n我们去公园。\n\n完',
    ]);
  });

  it('never makes a segment longer than the limit, and cuts at sentence ends', () => {
    const sentence = 'This is one sentence of a long chapter. ';
    const text = sentence.repeat(200);
    const segments = splitForSpeech(text, 300);
    expect(segments.length).toBeGreaterThan(20);
    for (const s of segments) {
      expect(s.length).toBeLessThanOrEqual(300);
      expect(s).toMatch(/\.$/);
    }
    // 字一个不少（只差空白）。
    expect(segments.join(' ').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });

  it('cuts a very long sentence without full stops at a comma or space', () => {
    const text = `${'一二三四五六七八九十，'.repeat(150)}完。`;
    const segments = splitForSpeech(text, SPEAK_SEGMENT_CHARS);
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) expect(s.length).toBeLessThanOrEqual(SPEAK_SEGMENT_CHARS);
    expect(segments[0]).toMatch(/，$/);
    expect(segments.join('')).toBe(text);
  });

  it('cuts text with no breaks at all, within the limit and without losing characters', () => {
    const text = 'a'.repeat(2500);
    const segments = splitForSpeech(text, 1000);
    expect(segments.length).toBe(3);
    for (const s of segments) expect(s.length).toBeLessThanOrEqual(1000);
    expect(segments.join('').replace(/\s/g, '')).toBe(text);
  });

  it('skips lines with only symbols and returns nothing for empty text', () => {
    expect(splitForSpeech('———\n\n* * *\n\nHello.')).toEqual(['Hello.']);
    expect(splitForSpeech('  \n\n ')).toEqual([]);
  });

  it('keeps numbers, which the voice reads', () => {
    expect(splitForSpeech('2026\n\n42')).toEqual(['2026\n\n42']);
  });

  it('keeps every segment within Android’s 4000-character limit at the default size', () => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(500);
    expect(text.length).toBeLessThanOrEqual(MAX_SPEAK_CHARS);
    for (const s of splitForSpeech(text)) expect(s.length).toBeLessThanOrEqual(4000);
  });
});

describe('chooseSpeakLanguage', () => {
  it('takes the language with the most characters among what the system detected', () => {
    const segments = ['Bonjour à tous, voici le rapport annuel.', 'OK', 'Merci.'];
    expect(chooseSpeakLanguage(segments, ['fr', 'en', 'fr'], 'en')).toBe('fr');
  });

  it('maps detected Chinese codes to simplified or traditional', () => {
    expect(chooseSpeakLanguage(['今天天气很好'], ['zh-Hans'], 'en')).toBe('zh-Hans');
    expect(chooseSpeakLanguage(['今天天氣很好'], ['zh-TW'], 'en')).toBe('zh-Hant');
    expect(chooseSpeakLanguage(['今天天气很好'], ['zh'], 'en')).toBe('zh-Hans');
  });

  it('falls back to the script when the system detects nothing', () => {
    expect(chooseSpeakLanguage(['今天天气很好。'], null, 'en')).toBe('zh-Hans');
    expect(chooseSpeakLanguage(['きょうはいい天気です。'], [null], 'en')).toBe('ja');
    expect(chooseSpeakLanguage(['오늘 날씨가 좋네요'], ['und'], 'zh')).toBe('ko');
    expect(chooseSpeakLanguage(['Привет, мир'], null, 'en')).toBe('ru');
  });

  it('reads unknown Latin-script text in English, or French with a French interface', () => {
    expect(chooseSpeakLanguage(['Lorem ipsum dolor'], null, 'zh')).toBe('en');
    expect(chooseSpeakLanguage(['Lorem ipsum dolor'], null, 'fr')).toBe('fr');
  });

  it('ignores detected languages that have no voice in the list', () => {
    expect(chooseSpeakLanguage(['Hej på dig'], ['sv'], 'en')).toBe('en');
  });

  it('gives up on text with no letters', () => {
    expect(chooseSpeakLanguage(['2026 42'], null, 'en')).toBeNull();
  });

  it('defaults to the interface language when one is needed', () => {
    expect(speakLanguageFor('zh')).toBe('zh-Hans');
    expect(speakLanguageFor('fr')).toBe('fr');
    expect(speakLanguageFor('en')).toBe('en');
  });
});

describe('estimateSpeechBytes', () => {
  it('estimates more bytes per character for Chinese than for English, and less when faster', () => {
    const zh = estimateSpeechBytes('今'.repeat(1000));
    const en = estimateSpeechBytes('a'.repeat(1000));
    expect(zh).toBeGreaterThan(en);
    // 1000 个汉字约 200 秒：24 kHz 16 位单声道约 9.6 MB。
    expect(zh).toBeGreaterThan(9_000_000);
    expect(zh).toBeLessThan(10_000_000);
    expect(estimateSpeechBytes('今'.repeat(1000), 2)).toBeLessThan(zh);
  });
});

describe('text to speech in quick actions', () => {
  it('has presets that fit together on every locale', () => {
    for (const id of ['pdf-to-audio', 'paper-to-audio']) {
      for (const locale of ['en', 'zh', 'fr'] as const) {
        const wf = presetWorkflow(presetById(id)!, locale, id);
        expect(wf.steps.map((s) => s.action)).toContain('audio.fromText');
        expect(workflowProblems(wf, registry)).toEqual([]);
      }
    }
  });

  it('has a single-step quick action on the audio tool page', () => {
    const wf = audioWorkflows('zh').find((w) => w.id === 'audio-from-text')!;
    expect(wf.steps.map((s) => s.action)).toEqual(['in.text', 'audio.fromText']);
    expect(workflowProblems(wf, registry)).toEqual([]);
  });

  it('understands the step phrases and can be followed by audio steps', () => {
    for (const phrase of [
      '转成语音',
      '朗读',
      '读出来',
      '文字转语音',
      'read it aloud',
      'text to speech',
    ]) {
      expect(parseStepPhrase(phrase, 'zh')?.action).toBe('audio.fromText');
    }
    // 「转成文字」仍是语音转文字，「转成 MP3」仍是转格式。
    expect(parseStepPhrase('转成文字', 'zh')?.action).toBe('audio.transcribe');
    expect(parseStepPhrase('转成 MP3', 'zh')?.action).toBe('audio.convert');
    const steps = stepsFrom(
      ['选 PDF', '提取文字', '转成语音', '转成 MP3', '分享'].map((p) => parseStepPhrase(p, 'zh')!),
    );
    expect(steps.map((s) => s.action)).toEqual([
      'in.files',
      'pdf.extractText',
      'audio.fromText',
      'audio.convert',
      'out.share',
    ]);
    expect(steps[2]!.params).toEqual({ lang: 'auto', rate: 1, format: 'm4a' });
    expect(workflowProblems({ id: 'x', name: 'x', steps }, registry).map((p) => p.code)).toEqual(
      [],
    );
  });
});
