import { describe, expect, it } from 'vitest';

import { groupItems } from './grouping';
import { createRegistry } from './registry';
import { BUILTIN_TOOLS } from './tools';

const at = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).getTime();
const item = (name: string, takenAt?: number) => ({
  name,
  ...(takenAt !== undefined ? { takenAt } : {}),
});

describe('groupItems', () => {
  it('without a rule keeps one group named after the first file (as before)', () => {
    expect(groupItems([item('a'), item('b')], undefined, undefined, '-')).toEqual([
      { name: 'a', items: [item('a'), item('b')] },
    ]);
  });

  it('every N files in the original order; the last group may be smaller', () => {
    const groups = groupItems(
      ['a', 'b', 'c', 'd', 'e'].map((n) => item(n)),
      'count',
      2,
      '-',
    );
    expect(groups.map((g) => [g.name, g.items.map((i) => i.name)])).toEqual([
      ['a', ['a', 'b']],
      ['c', ['c', 'd']],
      ['e', ['e']],
    ]);
  });

  it('by local day taken, earliest first, undated last', () => {
    const groups = groupItems(
      [
        item('late', at(10, 22, 23)),
        item('nodate'),
        item('early', at(10, 21, 0)),
        item('late2', at(10, 22, 1)),
      ],
      'day',
      undefined,
      'No date',
    );
    expect(groups.map((g) => [g.name, g.items.map((i) => i.name)])).toEqual([
      ['2026-10-21', ['early']],
      ['2026-10-22', ['late', 'late2']],
      ['No date', ['nodate']],
    ]);
  });

  it('by month, using the modified date when there is no capture date', () => {
    const groups = groupItems(
      [{ name: 'pdf', modifiedAt: at(9, 30) }, item('photo', at(10, 1))],
      'month',
      undefined,
      '-',
    );
    expect(groups.map((g) => g.name)).toEqual(['2026-09', '2026-10']);
  });
});

describe('group parameters', () => {
  const registry = createRegistry(BUILTIN_TOOLS);
  it('pdf.fromImages, pdf.merge and zip.create take a group rule; count needs a size', () => {
    for (const id of ['pdf.merge', 'zip.create']) {
      const params = registry.actions.get(id)!.params;
      expect(params.safeParse({ group: 'day' }).success).toBe(true);
      expect(params.safeParse({ group: 'count' }).success).toBe(false);
      expect(params.safeParse({ group: 'count', groupSize: 10 }).success).toBe(true);
      expect(params.safeParse({ group: 'weekday' }).success).toBe(false);
    }
    const fromImages = registry.actions.get('pdf.fromImages')!.params;
    const page = { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 0 };
    expect(fromImages.safeParse({ ...page, group: 'month' }).success).toBe(true);
    expect(fromImages.safeParse({ ...page, group: 'count', groupSize: 0 }).success).toBe(false);
  });
});
