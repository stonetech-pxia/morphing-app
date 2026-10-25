import type { Page } from '@morph/core';
import { useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewProps } from 'react-native';

import { PageView, type RenderEnv } from '../renderer/components';
import { useWorkspace } from '../workspace/context';
import { useEditActions } from './actions';
import { ArrangeView } from './ArrangeView';
import { EditSheet } from './EditSheet';
import { directEditEntry } from './entry';
import { useSingleDrag } from './useSingleDrag';

// 可以直接编辑的页面（D-052）：外壳和独立页面用它代替 PageView。
// 长按只选中单个组件并可继续拖动（D-235）；整页编辑保留 ArrangeView。
// 「完成」时整份草稿合成一个版本（D-054）。预览和系统页面不用它。

/** 保存版本后页面会重新挂载；记住滚动位置，改完仍停在原处。 */
const scrollOffsets = new Map<string, number>();

function rememberScroll(key: string): ScrollViewProps {
  return {
    contentOffset: { x: 0, y: scrollOffsets.get(key) ?? 0 },
    scrollEventThrottle: 32,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) =>
      void scrollOffsets.set(key, e.nativeEvent.contentOffset.y),
  };
}

export function EditablePage({
  page,
  env,
  bottomInset,
}: {
  page: Page;
  env: RenderEnv;
  bottomInset?: number;
}) {
  const editing = useWorkspace((s) => (s.editing?.pageId === page.id ? s.editing : null));
  const draft = editing?.config;
  const startEditing = useWorkspace((s) => s.startEditing);
  const shown = draft?.pages.find((p) => p.id === page.id) ?? page;
  const { edit, finish, cancel } = useEditActions(shown);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);

  const select = (id: string) => {
    startEditing(page.id, 'single');
    setSelected(id);
  };
  const drag = useSingleDrag(shown, select, (op) => edit([op]));
  const savedScroll = rememberScroll(page.id);

  const sheet = (
    <EditSheet
      page={shown}
      componentId={editing?.mode === 'page' ? selected : sheetId}
      palette={env.palette}
      onClose={() => {
        setSheetId(null);
        if (editing?.mode === 'page') setSelected(null);
      }}
    />
  );

  if (draft && editing?.mode === 'page') {
    return (
      <>
        <ArrangeView
          page={shown}
          env={{ ...env, config: draft }}
          bottomInset={bottomInset}
          scroll={rememberScroll(`${page.id}:edit`)}
          onEdit={setSelected}
          onMove={(op) => edit([op])}
          onDone={() => void finish()}
          onCancel={cancel}
        />
        {sheet}
      </>
    );
  }
  return (
    <>
      <PageView
        page={shown}
        env={
          directEditEntry.longPress && env.interactive && !env.locked
            ? {
                ...env,
                config: draft ?? env.config,
                focus: {
                  selectedId: draft ? selected : null,
                  onEdit: setSheetId,
                  onDone: () => {
                    if (!drag.draggingId) void finish();
                  },
                  drag,
                },
                edit: select,
              }
            : env
        }
        bottomInset={bottomInset}
        scroll={{
          ...savedScroll,
          ...drag.scroll,
          onScroll: (e) => {
            savedScroll.onScroll?.(e);
            drag.scroll.onScroll?.(e);
          },
        }}
      />
      {sheet}
    </>
  );
}
