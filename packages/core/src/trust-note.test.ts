import { describe, expect, it } from 'vitest';

import { en } from './messages/en';
import { fr } from './messages/fr';
import { zh } from './messages/zh';

// D-436：界面上叫 Tink，但信任说明必须告诉用户它是 AI、默认由谁提供。
describe('trust note says what Tink is', () => {
  it.each([
    ['en', en.trustNote, /Tink is this app’s AI/],
    ['zh', zh.trustNote, /Tink 是这个 App 里的 AI/],
    ['fr', fr.trustNote, /Tink est l’IA de cette application/],
  ])('%s', (_locale, note, says) => {
    expect(note).toMatch(says);
    expect(note).toContain('Claude');
    expect(note).toContain('Anthropic');
  });
});
