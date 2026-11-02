import {
  attachmentIds,
  knownValues,
  parsePickStore,
  PICK_STORE_KEY,
  putPick,
  ruleEngine,
  serializePickStore,
  usesValueMemory,
  type Collection,
  type FieldPick,
  type FieldSuggestions,
  type Locale,
  type PackNeed,
  type PrefillEngine,
  type ValueSuggestion,
} from '@morph/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { usePacks } from '../packs/PackHost';
import { VISION_LANGUAGES } from '../runtime/actions/ocr';
import { resolveOcrLanguage } from '../runtime/ocr-language';
import type { AssetRecord } from '../storage/types';
import { useWorkspaceContext } from '../workspace/context';
import {
  MAX_READ_FILES,
  missingPacks,
  readableKind,
  readAttachmentPages,
  ReadCancelled,
  type AttachmentTextDeps,
} from './attachment-text';

// 新记录表单的候选值（D-394）：附件里有照片或 PDF 时（表没有关掉 readAttachments，D-397），在后台读出文字，给每个空字段最多 3 个候选，
// 用户点了才填，从不自动填。文字识别模型装好了就自动读；没装时只显示一行提示，用户点了、
// 在下载确认框里同意以后才下载（D-064）。离开表单就取消。
// 点过的候选记在本机 app_meta 的 prefill:picks（这张表这个字段：标签和位置，不记值），
// 「设置 → 数据 → 预填记忆」能导出、恢复、清空。识别出的文字、文件名和记录都不发给 AI。
// 这张表存过的店名、公司现查记录（底线 14：不另存值，只读）。

export interface FieldSuggestionsState {
  /** 正在读附件。 */
  working: boolean;
  /** 还缺要下载的东西（文字识别模型、PDF 预览）：表单上面显示一行提示和按钮。 */
  missing: PackNeed[];
  suggestions: FieldSuggestions;
  /** 下载确认框要问的（点了提示里的按钮以后）。 */
  asking: PackNeed[] | null;
  ask(): void;
  /** 确认框关了：下载好了就重新读。 */
  answered(left: string[] | null): void;
  /** 用户点了一个候选：记下这张表这个字段的标签和位置。 */
  remember(fieldId: string, suggestion: ValueSuggestion): void;
}

const NONE: FieldSuggestions = {};
const NO_NEEDS: PackNeed[] = [];

export function useFieldSuggestions({
  enabled,
  collection,
  values,
  locale,
  engine = ruleEngine,
}: {
  /** 只在新记录的表单里（编辑已有的记录时不给候选）。 */
  enabled: boolean;
  collection: Collection | undefined;
  values: Record<string, unknown>;
  locale: Locale;
  /** 候选从哪里来（D-398）。 */
  engine?: PrefillEngine;
}): FieldSuggestionsState {
  const { repo, files } = useWorkspaceContext();
  const packs = usePacks();
  // 每次读的结果都带着这次读的依据（附件和下载次数）；依据变了，旧的结果就不算了。
  const [workingFor, setWorkingFor] = useState<string | null>(null);
  const [needs, setNeeds] = useState<{ run: string; list: PackNeed[] } | null>(null);
  const [found, setFound] = useState<{ run: string; suggestions: FieldSuggestions } | null>(null);
  const [asking, setAsking] = useState<PackNeed[] | null>(null);
  // 下载完以后加一，重新读一次。
  const [installs, setInstalls] = useState(0);
  const picks = useRef<Record<string, FieldPick>>({});

  // 附件字段里的文件（按字段顺序），作为重新读的依据。
  const ids = useMemo(
    () =>
      enabled && collection && collection.readAttachments !== false
        ? collection.fields.flatMap((f) => (f.type === 'file' ? attachmentIds(values[f.id]) : []))
        : [],
    [enabled, collection, values],
  );
  const key = ids.join(',');
  const run = `${key}#${installs}`;

  const deps = useMemo<AttachmentTextDeps>(
    () => ({
      files,
      packs: packs && {
        runtime: packs.bridge,
        isInstalled: (id: string) => packs.store.isInstalled(id),
      },
      languages: VISION_LANGUAGES[resolveOcrLanguage('auto', locale)],
      newRunId: () => `prefill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }),
    [files, packs, locale],
  );

  useEffect(() => {
    if (!collection || !key) return;
    const abort = new AbortController();
    void (async () => {
      const assets: AssetRecord[] = [];
      for (const id of key.split(',')) {
        const a = await repo.getAsset(id);
        if (a && readableKind(a)) assets.push(a);
      }
      const first = assets.slice(0, MAX_READ_FILES);
      if (abort.signal.aborted) return;
      if (first.length === 0) return;
      const kinds = first.map((a) => readableKind(a)!);
      const list = await missingPacks(kinds, deps);
      picks.current = parsePickStore(await repo.getMeta(PICK_STORE_KEY))[collection.id] ?? {};
      if (abort.signal.aborted) return;
      setNeeds({ run, list });
      setWorkingFor(run);
      try {
        const pages = await readAttachmentPages(first, deps, abort.signal);
        if (abort.signal.aborted) return;
        const known = collection.fields.some(usesValueMemory)
          ? knownValues(collection.fields, await repo.listRecords(collection.id))
          : {};
        if (abort.signal.aborted) return;
        const suggestions = await engine(
          { fields: collection.fields, pages, locale, picks: picks.current, known },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        setFound({ run, suggestions });
      } catch (e) {
        // 读不出来就没有候选，不报错。
        if (!(e instanceof ReadCancelled) && !abort.signal.aborted)
          setFound({ run, suggestions: NONE });
      } finally {
        if (!abort.signal.aborted) setWorkingFor(null);
      }
    })();
    return () => abort.abort();
  }, [collection, key, run, deps, repo, locale, engine]);

  const working = workingFor === run && key !== '';
  const missing = key && needs?.run === run ? needs.list : NO_NEEDS;
  const suggestions = key && found?.run === run ? found.suggestions : NONE;

  const ask = useCallback(() => setAsking(missing), [missing]);
  const answered = useCallback((left: string[] | null) => {
    setAsking(null);
    if (left !== null) setInstalls((n) => n + 1);
  }, []);
  const remember = useCallback(
    (fieldId: string, suggestion: ValueSuggestion) => {
      if (!collection) return;
      // 这个值在文字里找不到位置（没有 pick）：不记，字段原来的记忆留着。
      const pick = suggestion.pick;
      if (!pick) return;
      picks.current = { ...picks.current, [fieldId]: pick };
      void repo
        .getMeta(PICK_STORE_KEY)
        .then((raw) =>
          repo.setMeta(
            PICK_STORE_KEY,
            serializePickStore(putPick(parsePickStore(raw), collection.id, fieldId, pick)),
          ),
        )
        .catch(() => undefined);
    },
    [repo, collection],
  );

  return { working, missing, suggestions, asking, ask, answered, remember };
}
