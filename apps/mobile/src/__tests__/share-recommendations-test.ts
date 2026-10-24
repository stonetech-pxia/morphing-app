import type { SharedFileInfo, Workflow } from '@morph/core';

import { shareRecommendations } from '../share/recommendations';
import type { SucceededRuns } from '../storage/types';

const infos: SharedFileInfo[] = [{ name: 'x.jpg', mimeType: 'image/jpeg', size: 10 }];
const wf = (id: string, options: Partial<Workflow> = {}): Workflow => ({
  id,
  name: id,
  steps: [{ id: 'in', action: 'in.photos', params: { min: 1, max: 50 } }],
  ...options,
});
const usage = (...items: [string, number, number][]): SucceededRuns =>
  new Map(items.map(([id, count, lastAt]) => [id, { count, lastAt }]));

describe('inbox recommendations', () => {
  it('orders successful uses by count then latest start; caps recommendations at five', () => {
    const workflows = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => wf(id));
    const runs = usage(
      ['a', 1, 100],
      ['b', 2, 10],
      ['c', 2, 20],
      ['d', 3, 1],
      ['e', 1, 10],
      ['f', 1, 20],
    );
    const result = shareRecommendations(workflows, infos, runs, 'zh');
    expect(result.recommended.map((x) => x.wf.id)).toEqual(['d', 'c', 'b', 'a', 'f']);
    expect(result.all[5]!.wf.id).toBe('e');
  });
  it('fills fewer than three used actions: own, unadded presets, then tool actions', () => {
    const result = shareRecommendations(
      [wf('tool', { toolId: 'image' }), wf('own'), wf('used')],
      infos,
      usage(['used', 1, 1]),
      'zh',
    );
    expect(result.recommended).toHaveLength(5);
    expect(result.all.slice(0, 2).map((x) => x.wf.id)).toEqual(['used', 'own']);
    expect(result.all[2]!.preset).toBeDefined();
    expect(result.all.at(-1)!.wf.id).toBe('tool');
  });
  it('does not fill once three used actions exist, and puts a newly made action first', () => {
    const runs = usage(['a', 1, 1], ['b', 1, 2], ['c', 1, 3]);
    const workflows = ['a', 'b', 'c', 'new', 'unused'].map((id) => wf(id));
    expect(
      shareRecommendations(workflows, infos, runs, 'zh').recommended.map((x) => x.wf.id),
    ).toEqual(['c', 'b', 'a']);
    expect(
      shareRecommendations(workflows, infos, runs, 'zh', 'new').recommended.map((x) => x.wf.id),
    ).toEqual(['new', 'c', 'b', 'a']);
  });
  it('retains count mismatches only if used, never wrong types, and excludes added presets', () => {
    const tooFew = wf('few', {
      steps: [{ id: 'in', action: 'in.photos', params: { min: 2, max: 5 } }],
    });
    const tooMany = wf('many', {
      steps: [{ id: 'in', action: 'in.photos', params: { min: 1, max: 1 } }],
    });
    const wrong = wf('wrong', {
      steps: [{ id: 'in', action: 'in.files', params: { accept: 'pdf' } }],
    });
    const workflows = [tooFew, wrong, wf('added', { presetId: 'visa-photo' })];
    const empty = shareRecommendations(workflows, infos, new Map(), 'zh').all;
    expect(
      empty.some((x) => x.wf.id === 'few' || x.wf.id === 'wrong' || x.preset?.id === 'visa-photo'),
    ).toBe(false);
    const used = shareRecommendations(
      workflows,
      infos,
      usage(['few', 1, 1], ['wrong', 10, 2]),
      'zh',
    ).all;
    expect(used[0]).toMatchObject({ wf: { id: 'few' }, fit: { reason: 'tooFew' } });
    expect(used.some((x) => x.wf.id === 'wrong')).toBe(false);
    expect(
      shareRecommendations([tooMany], [...infos, ...infos], usage(['many', 1, 1]), 'zh')
        .recommended[0]!.fit,
    ).toMatchObject({ reason: 'tooMany' });
  });
});
