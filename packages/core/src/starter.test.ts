import { describe, expect, it } from 'vitest';

import { STARTER_TOOL_IDS, createStarterWorkspace } from './starter';
import { registry } from './test-helpers';
import { validateWorkspace } from './validate';

describe('createStarterWorkspace', () => {
  it.each(['zh', 'en'] as const)(
    'installs the starter tools and a four-item bar (%s)',
    (locale) => {
      const config = createStarterWorkspace(locale, registry);
      expect(validateWorkspace(config, registry).ok).toBe(true);
      expect(config.tools.map((t) => t.toolId)).toEqual([...STARTER_TOOL_IDS]);
      expect(config.shell.nav).toEqual(['page:home', 'tools', 'ai', 'settings']);
      const home = config.pages.find((p) => p.id === 'home')!;
      expect(
        home.components.filter((c) => c.type === 'toolCard').map((c) => c.props.toolId),
      ).toEqual([...STARTER_TOOL_IDS]);
      // 工具卡片在「添加工具」之前，最近文件仍在最后。
      expect(home.components.map((c) => c.type).slice(-2)).toEqual(['catalogLink', 'fileList']);
    },
  );
});
