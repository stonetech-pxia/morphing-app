import { describe, expect, it } from 'vitest';

import { isEmoji, isSafeLink, linkTarget, parseRichText, plainText } from './richtext';
import { apply, registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

describe('parseRichText', () => {
  it('parses bold, italic and links inside a paragraph', () => {
    expect(
      parseRichText('全部**在本机**处理，*不会*上传。[帮助](https://example.com/help)'),
    ).toEqual([
      {
        type: 'paragraph',
        spans: [
          { text: '全部' },
          { text: '在本机', bold: true },
          { text: '处理，' },
          { text: '不会', italic: true },
          { text: '上传。' },
          { text: '帮助', url: 'https://example.com/help' },
        ],
      },
    ]);
  });

  it('parses bullet and numbered lists and paragraphs', () => {
    const blocks = parseRichText('要点：\n- 第一\n• 第二\n\n1. 选择文件\n2) 合并');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list', 'list']);
    expect(blocks[1]).toMatchObject({
      ordered: false,
      items: [[{ text: '第一' }], [{ text: '第二' }]],
    });
    expect(blocks[2]).toMatchObject({ ordered: true });
  });

  it('keeps unsafe links as plain text and honours escapes', () => {
    expect(parseRichText('[点我](javascript:alert(1))')[0]).toEqual({
      type: 'paragraph',
      spans: [{ text: '点我' }, { text: ')' }],
    });
    expect(parseRichText('5 \\* 3 = 15 and a lone * star')[0]).toEqual({
      type: 'paragraph',
      spans: [{ text: '5 * 3 = 15 and a lone * star' }],
    });
    expect(plainText('**粗**和[链接](https://a.com)\n- 甲\n- 乙')).toBe('粗和链接 甲 / 乙');
  });

  it('only allows https and mailto links', () => {
    expect(isSafeLink('https://example.com/a?b=1')).toBe(true);
    expect(isSafeLink('mailto:me@example.com')).toBe(true);
    for (const bad of [
      'http://example.com',
      'javascript:alert(1)',
      'https://',
      'file:///etc/passwd',
      'tel:123',
    ]) {
      expect(isSafeLink(bad)).toBe(false);
    }
    expect(linkTarget('https://help.example.com/a/b')).toBe('help.example.com');
    expect(linkTarget('mailto:me@example.com')).toBe('me@example.com');
  });
});

describe('emoji icons', () => {
  it('accepts single emoji, including combined ones', () => {
    for (const e of ['💰', '📚', '❤️', '👨‍👩‍👧', '👍🏽', '🇨🇳', '1️⃣', '☕']) expect(isEmoji(e)).toBe(true);
    for (const s of ['', 'a', '钱', '💰💰💰💰💰💰💰💰💰💰💰', 'ab💰', '123'])
      expect(isEmoji(s)).toBe(false);
  });
});

describe('validation of rich content', () => {
  const issues = (config: unknown) => {
    const r = validateWorkspace(config, registry);
    return r.ok ? [] : r.issues.map((i) => i.message);
  };

  it('rejects unsafe links and non-emoji icons, accepts image slots', () => {
    const base = workspace();
    const withText = apply(base, [
      {
        op: 'addComponent',
        pageId: 'home',
        component: {
          id: 'intro',
          type: 'text',
          props: { text: '**你好** [帮助](https://example.com)' },
        },
      },
      {
        op: 'addComponent',
        pageId: 'home',
        component: { id: 'pic', type: 'image', props: { aspect: 'wide', fit: 'cover' } },
      },
      { op: 'setPageIcon', pageId: 'home', icon: '🏡' },
    ]);
    expect(issues(withText)).toEqual([]);

    const bad = JSON.parse(JSON.stringify(withText));
    bad.pages[0].components.at(-2).props.text = '[点我](http://evil.example)';
    bad.pages[0].icon = '房子';
    expect(issues(bad)).toEqual([
      'pages.0.icon: icon must be a listed icon name or a single emoji',
      'pages.0.components.3.props.text: links must be https:// or mailto: addresses',
    ]);
  });
});
