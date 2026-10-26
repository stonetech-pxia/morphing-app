import { describe, expect, it } from 'vitest';

import { filterFiles, matchesFileFilter, orientationOf, type FileFilter } from './file-filter';
import { createRegistry } from './registry';
import { BUILTIN_TOOLS } from './tools';

const NONE: FileFilter = {
  kind: 'any',
  size: 'any',
  orientation: 'any',
  date: 'any',
  duration: 'any',
  whenEmpty: 'stop',
};
const MB = 1024 * 1024;
// 2026-10-22 上午，设备本地时间。
const now = new Date(2026, 9, 22, 10, 0);
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

const photo = (name: string, w: number, h: number, takenAt?: number) => ({
  name,
  ext: 'heic',
  mimeType: 'image/heic',
  size: 3 * MB,
  width: w,
  height: h,
  ...(takenAt !== undefined ? { takenAt } : {}),
});

describe('file.filter conditions', () => {
  it('tells landscape, portrait and square apart, with a little slack for square', () => {
    expect(orientationOf(4032, 3024)).toBe('landscape');
    expect(orientationOf(3024, 4032)).toBe('portrait');
    expect(orientationOf(3024, 3000)).toBe('square');
  });

  it('keeps only photos taken in the last 7 days (today counts, day 8 does not)', () => {
    const items = [
      photo('today', 10, 20, at(2026, 10, 22, 8)),
      photo('day7', 10, 20, at(2026, 10, 16, 0)),
      photo('day8', 10, 20, at(2026, 10, 15, 23)),
      photo('noDate', 10, 20),
    ];
    const kept = filterFiles(items, { ...NONE, date: 'lastDays', days: 7 }, now);
    expect(kept.map((i) => i.name)).toEqual(['today', 'day7']);
  });

  it('keeps photos taken this month, using the same calendar periods as data tables', () => {
    const items = [
      photo('oct', 10, 20, at(2026, 10, 1, 0)),
      photo('sep', 10, 20, at(2026, 9, 30, 23)),
    ];
    const kept = filterFiles(items, { ...NONE, date: 'period', period: 'thisMonth' }, now);
    expect(kept.map((i) => i.name)).toEqual(['oct']);
  });

  it('uses the modified date of a file from Files when there is no capture date', () => {
    const pdf = {
      name: 'invoice',
      ext: 'pdf',
      mimeType: 'application/pdf',
      size: 1000,
      modifiedAt: at(2026, 3, 5),
    };
    const between = { ...NONE, date: 'between' as const, from: '2026-03-01', to: '2026-03-31' };
    expect(matchesFileFilter(pdf, between, now)).toBe(true);
    expect(matchesFileFilter({ ...pdf, modifiedAt: at(2026, 4, 1) }, between, now)).toBe(false);
  });

  it('combines conditions with AND', () => {
    const big = photo('big', 4000, 3000);
    const small = { ...photo('small', 4000, 3000), size: MB };
    const tall = photo('tall', 3000, 4000);
    const filter = {
      ...NONE,
      kind: 'images' as const,
      size: 'larger' as const,
      sizeMB: 2,
      orientation: 'landscape' as const,
    };
    expect(filterFiles([big, small, tall], filter, now).map((i) => i.name)).toEqual(['big']);
  });

  it('checks the kind by MIME type, and by extension when the MIME type is generic', () => {
    const mov = { name: 'clip', ext: 'mov', mimeType: 'application/octet-stream', size: 1 };
    const docx = { name: 'cv', ext: 'docx', mimeType: 'application/octet-stream', size: 1 };
    expect(matchesFileFilter(mov, { ...NONE, kind: 'video' }, now)).toBe(true);
    expect(matchesFileFilter(mov, { ...NONE, kind: 'images' }, now)).toBe(false);
    expect(matchesFileFilter(docx, { ...NONE, kind: 'documents' }, now)).toBe(true);
  });

  it('compares video length, and a file without a length does not count', () => {
    const clip = (name: string, durationMs?: number) => ({
      name,
      ext: 'mp4',
      mimeType: 'video/mp4',
      size: 1,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
    const short = { ...NONE, duration: 'shorter' as const, seconds: 60 };
    const kept = filterFiles([clip('a', 30_000), clip('b', 90_000), clip('c')], short, now);
    expect(kept.map((i) => i.name)).toEqual(['a']);
  });

  it('a photo without known size in pixels does not meet an orientation condition', () => {
    const unknown = { name: 'x', ext: 'jpg', mimeType: 'image/jpeg', size: 1 };
    expect(matchesFileFilter(unknown, { ...NONE, orientation: 'portrait' }, now)).toBe(false);
  });
});

describe('file.filter parameters', () => {
  const action = createRegistry(BUILTIN_TOOLS).actions.get('file.filter')!;
  const ok = (p: Record<string, unknown>) => action.params.safeParse(p).success;

  it('needs at least one real condition', () => {
    expect(ok({ ...NONE })).toBe(false);
    expect(ok({ ...NONE, kind: 'pdf' })).toBe(true);
  });

  it('needs the number that goes with each condition, and a date range in order', () => {
    expect(ok({ ...NONE, size: 'larger' })).toBe(false);
    expect(ok({ ...NONE, date: 'lastDays' })).toBe(false);
    expect(ok({ ...NONE, duration: 'longer' })).toBe(false);
    expect(ok({ ...NONE, date: 'between', from: '2026-03-31', to: '2026-03-01' })).toBe(false);
    expect(ok({ ...NONE, date: 'between', from: '2026-03-01', to: '2026-03-31' })).toBe(true);
  });

  it('does not accept free text as a condition', () => {
    expect(ok({ ...NONE, kind: 'pdf', where: 'size > 10' })).toBe(false);
    expect(ok({ ...NONE, date: 'between', from: 'last week', to: '2026-03-31' })).toBe(false);
  });
});
