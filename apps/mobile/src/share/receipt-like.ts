import { rulePreset } from '@morph/core';
import { useEffect, useMemo, useState } from 'react';

import { readableKind, readPagesOf, type AttachmentTextDeps } from '../data/attachment-text';
import { usePacks } from '../packs/PackHost';
import { VISION_LANGUAGES } from '../runtime/actions/ocr';
import { resolveOcrLanguage } from '../runtime/ocr-language';
import type { PickedFile } from '../runtime/platform';
import { useWorkspaceContext } from '../workspace/context';

/**
 * 收到的文件像不像收据（有合计金额的小票、账单、发票，D-476、D-477）：在本机读前 3 个文件里的文字，
 * 用规则看（`rulePreset`），读完就丢，不存、不发给 AI。文字识别用不了、读不出来、不像：都是 false，
 * 面板照旧，不报错。没有带收据规则的表时不读（没有可推荐的）。只读不改，原件不动（底线 4）。
 */
export function useReceiptLike(picked: readonly PickedFile[], enabled: boolean): boolean {
  const { files, locale } = useWorkspaceContext();
  const packs = usePacks();
  const [like, setLike] = useState(false);
  const deps = useMemo<AttachmentTextDeps>(
    () => ({
      files,
      packs: packs && {
        runtime: packs.bridge,
        isInstalled: (id: string) => packs.store.isInstalled(id),
      },
      languages: VISION_LANGUAGES[resolveOcrLanguage('auto', locale)],
      newRunId: () => `receipt-like-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }),
    [files, packs, locale],
  );
  const key = picked.map((p) => p.uri).join('|');
  useEffect(() => {
    const items = picked.flatMap((p) => {
      const kind = readableKind({ mimeType: p.mimeType ?? '', name: p.name });
      // 只读照片：PDF 要再读一遍文字层或画页，表单里还要读一次，先不做。
      return kind === 'image' ? [{ kind, uri: p.uri }] : [];
    });
    if (!enabled || items.length === 0) return;
    const abort = new AbortController();
    void readPagesOf(items, deps, abort.signal)
      .then((pages) => {
        if (!abort.signal.aborted) setLike(rulePreset(pages) === 'purchase');
      })
      .catch(() => undefined);
    return () => abort.abort();
    // key 代表这批文件；picked 本身每次渲染都是新数组。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, deps, enabled]);
  return like;
}
