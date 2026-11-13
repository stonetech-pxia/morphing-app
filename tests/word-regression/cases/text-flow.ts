// text-flow 套件：段落、分栏和阅读顺序、标题、列表。
import { apart, order, together } from '../lib/checks';
import type { Case } from '../lib/case';

export const TEXT_FLOW: Case[] = [
  {
    id: 'two-column-prose',
    suite: 'text-flow',
    fix: 'b29d8d16',
    what: 'Two-column article under a full-width title: the left column is read before the right one.',
    checks: [
      order('Left column starts here', 'end of the left column', 'Right column starts here'),
      apart('end of the left column', 'Right column starts here'),
      together('Left column starts here', 'end of the left column'),
    ],
  },
];
