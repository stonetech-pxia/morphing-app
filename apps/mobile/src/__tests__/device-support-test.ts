import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createRegistry,
  deskToolbar,
  quickActionsOf,
  type SharedFileInfo,
  type Workflow,
} from '@morph/core';

import { toolEntries } from '../desk/DeskToolbar';
import { runsHere } from '../runtime/device-support';
import { shareRecommendations } from '../share/recommendations';

// PDF 密码（加密码、去掉密码）只有 iOS 做了（P-025）。Android 上没有原生模块（测试里也没有），
// 入口不显示：创始人 2026-10-31「识别安卓，不要显示这个功能」。

const registry = createRegistry(BUILTIN_TOOLS);
const config = createDefaultWorkspace('zh');
const pdf: SharedFileInfo = { name: 'a.pdf', mimeType: 'application/pdf', size: 10 };
const PASSWORD = ['pdf.protect', 'pdf.unlock'];

const protect: Workflow = {
  kind: 'quickAction',
  id: 'mine-protect',
  name: 'mine',
  steps: [
    { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 10 } },
    { id: 'run', action: 'pdf.protect', params: {} },
  ],
};

describe('没有 PDF 密码模块的手机', () => {
  it('用到密码的快捷操作不能在这里运行', () => {
    expect(runsHere(protect)).toBe(false);
    expect(runsHere({ ...protect, steps: protect.steps.slice(0, 1) })).toBe(true);
  });

  it('PDF 桌面的工具栏没有加密码、去掉密码', () => {
    const file = {
      id: 'f',
      name: 'a',
      ext: 'pdf',
      mimeType: 'application/pdf',
      size: 10,
      uri: 'file:///a.pdf',
    } as never;
    const groups = toolEntries(
      deskToolbar('pdf', {}, registry, quickActionsOf(config), 'zh'),
      [file],
      registry,
      quickActionsOf(config),
      'zh',
    );
    const items = groups.flatMap((g) => g.entries.map((e) => e.item));
    const actions = items.flatMap((i) => (typeof i === 'object' ? [i.action] : []));
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.filter((a) => PASSWORD.includes(a))).toEqual([]);
    expect(items.filter((i) => i === 'pdf-protect' || i === 'pdf-unlock')).toEqual([]);
  });

  it('收件页不推荐，「查看全部」里也没有', () => {
    const result = shareRecommendations(
      [...quickActionsOf(config), protect],
      [pdf],
      new Map([['mine-protect', { count: 9, lastAt: 1 }]]),
      'zh',
    );
    const ids = result.all.map((r) => r.wf.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => ['mine-protect', 'pdf-protect', 'pdf-unlock'].includes(id))).toEqual(
      [],
    );
  });
});
