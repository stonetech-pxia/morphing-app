import type { Locale } from '@morph/core';
import { useState, type ReactNode } from 'react';

import type { Palette } from '../renderer/theme';
import { useWorkspaceContext } from '../workspace/context';
import { FILE_BUNDLE_ASKED, fileBundleToOffer } from './file-bundle';
import { PackGate } from './PackGate';
import { usePacks } from './PackHost';

/**
 * 文件处理包一次问完（D-456）：offer() 在第一次扫描完、分享或打开文件后调用；问过就不再问。
 * 用户点了下载或以后再说才记下「问过了」（底线 16：写入来自用户的操作）。
 */
export function useFileBundleOffer(
  palette: Palette,
  locale: Locale,
): { offer: () => void; element: ReactNode } {
  const { repo, files } = useWorkspaceContext();
  const packs = usePacks();
  const [needs, setNeeds] = useState<string[] | null>(null);

  function offer() {
    if (!packs) return;
    void fileBundleToOffer(repo, files, packs.store)
      .then((missing) => {
        if (missing.length > 0) setNeeds(missing);
      })
      .catch(() => {
        // 读不到时这次不问，下次再说。
      });
  }

  const element =
    needs && packs ? (
      <PackGate
        bundle
        needs={needs.map((pack) => ({ pack, optional: true }))}
        store={packs.store}
        palette={palette}
        locale={locale}
        onDone={() => {
          setNeeds(null);
          void repo.setMeta(FILE_BUNDLE_ASKED, '1');
        }}
      />
    ) : null;
  return { offer, element };
}
