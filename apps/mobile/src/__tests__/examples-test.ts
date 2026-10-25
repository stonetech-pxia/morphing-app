import { aboutCandidates } from '../shell/examples';

describe('examples about a quick action or shared files (D-124)', () => {
  const visa = { kind: 'workflow', workflowId: 'visa' } as const;

  it('leaves out “put it on the home page” when it is already there', () => {
    expect(aboutCandidates(visa, 'server', 'zh')).toContain('把它放到首页');
    expect(aboutCandidates(visa, 'server', 'zh', { onHome: true })).not.toContain('把它放到首页');
    expect(aboutCandidates(visa, 'mock', 'zh', { onHome: true })).not.toContain('把这个放到首页');
  });

  it('only suggests stitching when there are two photos or more', () => {
    const one = { kind: 'shared', images: 1, pdfs: 0, others: 0 } as const;
    const two = { kind: 'shared', images: 2, pdfs: 0, others: 0 } as const;
    expect(aboutCandidates(one, 'server', 'zh')).not.toContain('拼成一张长图');
    expect(aboutCandidates(two, 'server', 'zh')).toContain('拼成一张长图');
    expect(aboutCandidates(one, 'server', 'en').some((e) => /stitch/i.test(e))).toBe(false);
  });
});
