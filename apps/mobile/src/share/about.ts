import type { PlanAbout } from '@morph/core';

import { mimeOf } from '../runtime/actions/helpers';
import type { IncomingShare } from './incoming';

/** 发给 AI 的只有分享文件的类型和个数（D-124），没有文件名、大小和内容。 */
export function sharedAbout(share: IncomingShare): Extract<PlanAbout, { kind: 'shared' }> {
  let images = 0;
  let pdfs = 0;
  let others = 0;
  for (const f of share.files) {
    const mime = mimeOf(f.name, f.mimeType);
    if (mime.startsWith('image/')) images++;
    else if (mime === 'application/pdf') pdfs++;
    else others++;
  }
  return { kind: 'shared', images, pdfs, others };
}
