import { describe, expect, it } from 'vitest';

import { prepareOps } from './change';
import { describePresetApply } from './describe';
import { createDefaultWorkspace } from './defaults';
import { V4_FIXED_NAME } from './fixtures/v4';
import { applyOps, type Op } from './ops';
import {
  MAX_PRESET_NAME,
  MAX_SAVED_PRESETS,
  canSavePreset,
  preparePreset,
  presetName,
  presetSnapshot,
} from './saved-presets';
import { CURRENT_SCHEMA_VERSION, allComponents, type WorkspaceConfig } from './schema';
import { registry } from './test-helpers';
import { validateWorkspace } from './validate';

const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 10, 3) };
const FILE_A = 'fileaaaa01';
const FILE_B = 'filebbbb02';
const FILE_C = 'filecccc03';
const FILE_D = 'filedddd04';

/** 配置里指向用户文件的四处都填上（文件位、分组里的图片、卡片的图片背景、页面的图片背景）。 */
function withFiles(): WorkspaceConfig {
  const ops: Op[] = [
    {
      op: 'addData',
      table: { id: 'notes', name: '笔记', fields: [{ id: 'title', name: '标题', type: 'text' }] },
    },
    {
      op: 'addContainer',
      page: 'home',
      block: {
        id: 'slot',
        look: 'entry',
        show: { title: '合同', icon: 'folder' },
        opens: { file: FILE_A },
      },
    },
    {
      op: 'addContainer',
      page: 'home',
      block: {
        id: 'grp',
        look: 'group',
        show: { layout: 'stack' },
        children: [
          { id: 'pic', look: 'image', show: { asset: FILE_B, aspect: 'wide', fit: 'cover' } },
        ],
      },
    },
    {
      op: 'addContainer',
      page: 'home',
      block: {
        id: 'note',
        look: 'entry',
        show: { title: '你好', icon: 'star' },
        opens: 'settings',
        style: { backdrop: { overlay: 'light', assetId: FILE_C } },
      },
    },
    {
      op: 'updateContainer',
      page: 'home',
      changes: { backdrop: { overlay: 'strong', assetId: FILE_D } },
    },
  ];
  const r = applyOps(createDefaultWorkspace('zh'), ops, ctx);
  if (!r.ok) throw new Error(r.error);
  return r.config;
}

describe('saved presets (D-410)', () => {
  it('names: trims, refuses empty, cuts very long ones without breaking a character', () => {
    expect(presetName('  我的记账  ')).toBe('我的记账');
    expect(presetName('a  \n b')).toBe('a b');
    expect(presetName('')).toBeNull();
    expect(presetName('   \n ')).toBeNull();
    const long = presetName('😀'.repeat(MAX_PRESET_NAME + 20))!;
    expect(Array.from(long)).toHaveLength(MAX_PRESET_NAME);
    expect(long).toBe('😀'.repeat(MAX_PRESET_NAME));
  });

  it('holds at most 50', () => {
    expect(MAX_SAVED_PRESETS).toBe(50);
    expect(canSavePreset(0)).toBe(true);
    expect(canSavePreset(49)).toBe(true);
    expect(canSavePreset(50)).toBe(false);
    expect(canSavePreset(51)).toBe(false);
  });

  it('a snapshot keeps the whole app but no reference to a user file, in all four places', () => {
    const config = withFiles();
    const text = JSON.stringify(config);
    for (const id of [FILE_A, FILE_B, FILE_C, FILE_D]) expect(text).toContain(id);

    const snap = presetSnapshot(config);
    const saved = JSON.stringify(snap);
    for (const id of [FILE_A, FILE_B, FILE_C, FILE_D]) expect(saved).not.toContain(id);

    const home = snap.containers.pages.find((p) => p.id === 'home')!;
    const block = (id: string) =>
      allComponents(home).find((c) => c.id === id)! as never as {
        opens?: { file: string | null };
        show?: { asset?: string | null };
        style?: { backdrop?: { overlay: string; assetId?: string } };
      };
    // 文件位和图片还在，只是空的；图片背景还开着，没有图片。
    expect(block('slot').opens).toEqual({ file: null });
    expect(block('pic').show!.asset).toBeNull();
    expect(block('note').style!.backdrop).toEqual({ overlay: 'light' });
    expect(home.backdrop).toEqual({ overlay: 'strong' });
    // 整个 App 都在：表结构、页面、主题、工具。
    expect(snap.data.tables.map((t) => t.id)).toEqual(config.data.tables.map((t) => t.id));
    expect(snap.theme).toEqual(config.theme);
    expect(snap.tools).toEqual(config.tools);
    // 没有悬空的引用，能通过校验（底线 18）。
    expect(validateWorkspace(snap, registry).ok).toBe(true);
    // 原来的配置没被改。
    expect(JSON.stringify(config)).toBe(text);
  });

  it('old presets are upgraded before they are applied (底线 12)', () => {
    const prepared = preparePreset(V4_FIXED_NAME, registry);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.after.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('applying clears file references again, whatever the stored copy holds (底线 3、18)', () => {
    const prepared = preparePreset(JSON.parse(JSON.stringify(withFiles())), registry);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(JSON.stringify(prepared.after)).not.toContain(FILE_A);
  });

  it('a broken preset is refused, not applied', () => {
    expect(preparePreset(null, registry).ok).toBe(false);
    expect(preparePreset({ schemaVersion: 1, nonsense: true }, registry).ok).toBe(false);
  });

  it('the preview says tables leave but their entries stay, and that picked files are not carried', () => {
    const before = withFiles();
    const removed = prepareOps(before, [{ op: 'removeData', table: 'notes' }], ctx);
    if (!removed.ok) throw new Error(removed.issues.join());
    const lines = describePresetApply(before, presetSnapshot(removed.after), '极简', ctx);
    expect(lines[0]).toContain('极简');
    expect(lines.join('\n')).toContain('笔记');
    expect(lines.join('\n')).toMatch(/记录/);
    // 现在选好的文件位和图片不会跟过来，要说清楚。
    expect(lines.join('\n')).toContain('重新选');

    const plain = createDefaultWorkspace('zh');
    const quiet = describePresetApply(plain, presetSnapshot(plain), '极简', ctx);
    expect(quiet.join('\n')).not.toContain('重新选');
  });
});
