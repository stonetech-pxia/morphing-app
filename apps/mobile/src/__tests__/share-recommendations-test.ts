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
  it('does not let greyed-out used actions crowd out runnable ones', () => {
    const needsTwo = (id: string) =>
      wf(id, { steps: [{ id: 'in', action: 'in.photos', params: { min: 2, max: 50 } }] });
    const result = shareRecommendations(
      [needsTwo('x'), needsTwo('y'), needsTwo('z'), wf('own')],
      infos,
      usage(['x', 20, 1], ['y', 10, 1], ['z', 5, 1]),
      'zh',
    );
    // 三个用过但个数不对的不算「用过的够了」：能运行的还要补上来，而且排在灰卡片前面。
    const ids = result.recommended.map((r) => r.wf.id);
    expect(ids[0]).toBe('own');
    expect(result.recommended.filter((r) => r.fit.ok).length).toBeGreaterThan(0);
    expect(result.anyUsed).toBe(true);
  });
  it('ranks built-in quick actions by their own run history (D-236)', () => {
    const result = shareRecommendations(
      [wf('own')],
      infos,
      usage(['visa-photo', 3, 1], ['own', 1, 1]),
      'zh',
    );
    expect(result.recommended.map((x) => x.wf.id).slice(0, 2)).toEqual(['visa-photo', 'own']);
    expect(result.anyUsed).toBe(true);
  });
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
  it('fills fewer than three used actions: own, built-in, then tool actions', () => {
    const result = shareRecommendations(
      [wf('tool', { toolId: 'image' }), wf('own'), wf('used')],
      infos,
      usage(['used', 1, 1]),
      'zh',
    );
    expect(result.recommended).toHaveLength(5);
    expect(result.all.slice(0, 2).map((x) => x.wf.id)).toEqual(['used', 'own']);
    expect(result.all[2]!.wf.presetId).toBeDefined();
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
  it('retains count mismatches only if used, never wrong types, and hides copied built-ins', () => {
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
      empty.some((x) => x.wf.id === 'few' || x.wf.id === 'wrong' || x.wf.id === 'visa-photo'),
    ).toBe(false);
    const used = shareRecommendations(
      workflows,
      infos,
      usage(['few', 1, 1], ['wrong', 10, 2]),
      'zh',
    ).all;
    // 用过但个数不对的照样列出来（灰掉、说明原因），但先保证前面有 3 个能运行的。
    expect(used.slice(0, 3).every((x) => x.fit.ok)).toBe(true);
    expect(used[3]).toMatchObject({ wf: { id: 'few' }, fit: { reason: 'tooFew' } });
    expect(used.some((x) => x.wf.id === 'wrong')).toBe(false);
    expect(
      shareRecommendations(
        [tooMany],
        [...infos, ...infos],
        usage(['many', 1, 1]),
        'zh',
      ).recommended.find((r) => r.wf.id === 'many')?.fit,
    ).toMatchObject({ reason: 'tooMany' });
  });
  it('fills a new user with the most common built-in actions for this kind of file (D-237)', () => {
    const ids = (files: SharedFileInfo[]) =>
      shareRecommendations([], files, new Map(), 'zh').recommended.map((x) => x.wf.id);
    expect(ids(infos)).toEqual([
      'email-photos',
      'scan-document',
      'scan-table-excel',
      'document-packet',
      'visa-photo',
    ]);
    expect(ids([{ name: 'a.pdf', mimeType: 'application/pdf', size: 1 }])).toEqual([
      'pdf-too-big',
      'sign-return',
      'combine-documents',
      'foreign-pdf',
      // 不在 D-237 清单里、但接得上 PDF 的内设快捷操作跟在后面（D-270）。
      'pdf-to-audio',
    ]);
    // 自己做的没用过的仍排在内设的前面；用过的按次数排在最前。
    expect(
      shareRecommendations([wf('own'), wf('used')], infos, usage(['used', 1, 1]), 'zh')
        .recommended.slice(0, 3)
        .map((x) => x.wf.id),
    ).toEqual(['used', 'own', 'email-photos']);
  });
  it('ranks a tool action that has the same id as a listed built-in one (video-frame) (D-237)', () => {
    const toolFrame = wf('video-frame', {
      toolId: 'video',
      steps: [{ id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } }],
    });
    const ids = shareRecommendations(
      [toolFrame],
      [{ name: 'clip.mp4', mimeType: 'video/mp4', size: 1 }],
      new Map(),
      'zh',
    ).recommended.map((x) => x.wf.id);
    expect(ids).toEqual([
      'video-too-big',
      'video-sound',
      'video-frame',
      'mute-video',
      'fix-video-rotation',
    ]);
  });
});
