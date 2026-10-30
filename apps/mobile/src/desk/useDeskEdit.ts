import type { Desk, DeskFile } from '@morph/core';
import {
  pushHistory,
  redo as redoHistory,
  startHistory,
  undo as undoHistory,
  type DocDoc,
  type History,
  type TableDoc,
} from '@morph/tool-office';
import { useEffect, useRef, useState } from 'react';

import type { FilePlatform } from '../runtime/platform';
import {
  commitEdit,
  dropEditDraft,
  loadDeskSource,
  writeEditDraft,
  type DeskSourceDoc,
} from './store';

// 房间里改表格、文档（file-room §11.2，D-345，创始人 2026-10-30 确认 §10 第 4 题选 A）：
// 改动先一步步记在内存里（History，最多 100 步），顶部的撤销先退这些；连续的一段编辑在这些时候合上、成为
// 桌上的一个版本（「编辑了表格」，撤销时整段一起退）：用别的工具、打开「完成」（保存、分享）、离开房间、
// 切到别的文件、App 进后台。没合上的编辑每改一下写进桌面（editing.json），App 被关掉也不丢。

export interface EditSession {
  /** 正在改的那份文件（桌上的 ID）。 */
  fileId: string;
  kind: DeskSourceDoc['kind'];
  /** 这一段编辑开始时的样子：和它一样就是没改。 */
  base: TableDoc | DocDoc;
  history: History<TableDoc | DocDoc>;
}

export interface DeskEdit {
  /** undefined：还在读；null：这份文件不能改（没有中间格式、读不出来）。 */
  session: EditSession | null | undefined;
  apply(next: TableDoc | DocDoc): void;
  undo(): void;
  redo(): void;
  /** 改过、还没合上。 */
  dirty: boolean;
  /** 合上（没改过时什么都不做），返回现在的桌面。 */
  seal(): Promise<Desk | null>;
}

export function useDeskEdit({
  files,
  desk,
  file,
  onSealed,
}: {
  files: FilePlatform;
  /** 现在的桌面（ref：合上时要最新的）。 */
  desk: { readonly current: Desk | null };
  /** 正在看的文件。 */
  file: DeskFile | null;
  /** 合上了：桌面换成新的，正在看的文件换成新的 ID。 */
  onSealed: (desk: Desk, fileId: string) => void;
}): DeskEdit {
  // 读好的那一份（按文件 ID）：正在看的文件换了、还没读好时当作「还在读」。
  const [loaded, setLoaded] = useState<{ fileId: string; session: EditSession | null } | null>(
    null,
  );
  const ref = useRef<EditSession | null>(null);
  const setSession = (fileId: string, next: EditSession | null) => {
    ref.current = next;
    setLoaded({ fileId, session: next });
  };
  // 写「编辑中」文件排队写（后一次覆盖前一次）；合上前先等它写完。
  const writing = useRef<Promise<unknown>>(Promise.resolve());
  const sealing = useRef<Promise<Desk | null> | null>(null);

  const fileId = file?.id ?? null;
  const editable = !!file?.source;
  const session =
    !file || !editable ? null : loaded?.fileId === file.id ? loaded.session : undefined;
  useEffect(() => {
    // 刚合上时已经换成了新文件的那一段（不用重新读）。
    if (!file || !editable || ref.current?.fileId === file.id) return;
    ref.current = null;
    let alive = true;
    const current = desk.current;
    if (!current) return;
    loadDeskSource(files, current, file).then(
      (source) => {
        if (!alive) return;
        setSession(
          file.id,
          source
            ? {
                fileId: file.id,
                kind: source.kind,
                base: source.doc,
                history: startHistory<TableDoc | DocDoc>(source.doc),
              }
            : null,
        );
      },
      () => alive && setSession(file.id, null),
    );
    return () => {
      alive = false;
    };
    // 只跟着正在看的文件变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, fileId, editable]);

  /** 改完一步：记下来，写进「编辑中」文件；退回到开始的样子时删掉它。 */
  function update(history: History<TableDoc | DocDoc>) {
    const s = ref.current;
    const current = desk.current;
    if (!s || !current) return;
    setSession(s.fileId, { ...s, history });
    const doc = history.present;
    writing.current = writing.current
      .catch(() => undefined)
      .then(() =>
        doc === s.base
          ? dropEditDraft(files, current)
          : writeEditDraft(files, current, s.fileId, { kind: s.kind, doc } as DeskSourceDoc),
      );
  }

  async function sealNow(): Promise<Desk | null> {
    await writing.current.catch(() => undefined);
    const s = ref.current;
    const current = desk.current;
    if (!s || !current || s.history.present === s.base) return current;
    const doc = s.history.present;
    const done = await commitEdit(
      files,
      current,
      s.fileId,
      { kind: s.kind, doc } as DeskSourceDoc,
      Date.now(),
    );
    setSession(done.fileId, {
      fileId: done.fileId,
      kind: s.kind,
      base: doc,
      history: startHistory(doc),
    });
    onSealed(done.desk, done.fileId);
    return done.desk;
  }

  return {
    session,
    dirty: !!session && session.history.present !== session.base,
    apply: (next) => ref.current && update(pushHistory(ref.current.history, next)),
    undo: () => ref.current && update(undoHistory(ref.current.history)),
    redo: () => ref.current && update(redoHistory(ref.current.history)),
    seal() {
      // 几个地方同时要合上（例如点了工具又离开）：只合一次。
      sealing.current ??= sealNow().finally(() => {
        sealing.current = null;
      });
      return sealing.current;
    },
  };
}
