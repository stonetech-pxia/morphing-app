import { describe, expect, it } from 'vitest';
import { speechToSrt } from './subtitles';

describe('SRT subtitles', () => {
  it('retains leading silence, groups native word timestamps, preserves long gaps and formats hours', () => {
    const srt = speechToSrt(
      [
        { startMs: 1200, endMs: 1500, text: 'Hello' },
        { startMs: 1510, endMs: 2100, text: 'world.' },
        { startMs: 3601002, endMs: 3601800, text: 'Later.' },
      ],
      'en',
      3602000,
    );
    expect(srt).toBe(
      '1\r\n00:00:01,200 --> 00:00:02,100\r\nHello world.\r\n\r\n2\r\n01:00:01,002 --> 01:00:01,800\r\nLater.\r\n',
    );
  });
  it('sorts timestamps, clips them to video duration and rejects invalid or noise-only segments', () => {
    const srt = speechToSrt(
      [
        { startMs: 4000, endMs: 6000, text: 'Last.' },
        { startMs: -500, endMs: 1200, text: 'First.' },
        { startMs: 1000, endMs: 2000, text: 'Next.' },
        { startMs: NaN, endMs: 3000, text: 'bad' },
        { startMs: 100, endMs: 0, text: 'bad' },
        { startMs: 3000, endMs: 3500, text: '[Music]' },
      ],
      'en',
      5000,
    );
    expect(srt).toContain('00:00:00,000 --> 00:00:01,200');
    expect(srt).toContain('00:00:01,200 --> 00:00:02,000');
    expect(srt).toContain('00:00:04,000 --> 00:00:05,000');
    expect(srt).not.toContain('bad');
    expect(srt).not.toContain('Music');
  });
  it('wraps and splits long recognition segments using their actual span without moving the video timeline', () => {
    const srt = speechToSrt(
      [
        {
          startMs: 1000,
          endMs: 9000,
          text: 'One clear sentence about a sample video and its local subtitles, followed by enough words to require more than one subtitle cue.',
        },
      ],
      'en',
      10000,
    );
    expect(srt).toContain('00:00:01,000');
    expect(srt).toContain('00:00:09,000');
    expect(srt).toContain('\r\n\r\n2\r\n');
    const cn = speechToSrt(
      [
        { startMs: 1000, endMs: 1500, text: '你好' },
        { startMs: 1500, endMs: 2000, text: '世界。' },
      ],
      'zh',
      3000,
    );
    expect(cn).toContain('你好世界。');
    expect(cn).not.toContain('你好 世界');
    expect(speechToSrt([], 'en', 1000)).toBe('');
    expect(speechToSrt([{ startMs: 0, endMs: 100, text: 'hello' }], 'en', NaN)).toBe('');
  });
});
