import { describe, expect, it } from 'vitest';

import { builtinText } from './builtin-text';
import { pageTarget, TOOLBOX_PAGE_ID } from './schema';
import { createStarterWorkspace } from './starter';
import { registry } from './test-helpers';

// 用户报告（2026-11-06 模拟器）：中文建的工作空间切到法文后，工具箱的分组名、已装工具的名字还是中文。
describe('builtinText', () => {
  const zh = createStarterWorkspace('zh', registry);
  const toolbox = zh.containers.pages.find((p) => p.id === TOOLBOX_PAGE_ID)!;
  const imagePage = zh.containers.pages.find((p) => p.package === 'image')!;

  it('shows the starter texts of a Chinese workspace in French and English', () => {
    expect(builtinText(toolbox.title, 'fr', registry)).toBe(
      createStarterWorkspace('fr', registry).containers.pages.find((p) => p.id === TOOLBOX_PAGE_ID)!
        .title,
    );
    expect(builtinText('照片、视频和声音', 'en', registry)).toBe('Photos, video and audio');
    expect(builtinText(imagePage.title, 'en', registry)).not.toMatch(/[一-鿿]/);
    expect(builtinText('图片转 PDF', 'fr', registry)).toBe('Images en PDF');
    expect(builtinText('最近操作', 'en', registry)).not.toMatch(/[一-鿿]/);
  });

  it('keeps what the user wrote', () => {
    expect(builtinText('我的工具', 'en', registry)).toBe('我的工具');
    expect(builtinText(undefined, 'en', registry)).toBeUndefined();
    expect(builtinText('', 'en', registry)).toBe('');
  });

  it('round-trips between all three languages', () => {
    const fr = builtinText('Photos, video and audio', 'fr', registry);
    expect(builtinText(fr, 'zh', registry)).toBe('照片、视频和声音');
  });

  it('does not translate ids and targets', () => {
    expect(builtinText(pageTarget(TOOLBOX_PAGE_ID), 'zh', registry)).toBe(
      pageTarget(TOOLBOX_PAGE_ID),
    );
  });
});
