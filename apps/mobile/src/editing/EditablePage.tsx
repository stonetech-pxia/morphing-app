import type { Page } from '@morph/core';
import { useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewProps } from 'react-native';

import { PageView, type RenderEnv } from '../renderer/components';
import { useWorkspace } from '../workspace/context';
import { useEditActions } from './actions';
import { ArrangeView } from './ArrangeView';
import { EditSheet } from './EditSheet';

// 可以直接编辑的页面（D-052）：外壳和独立页面用它代替 PageView。
// 平时长按组件进入编辑模式并打开它的操作面板；编辑模式下显示草稿，换成带把手和箭头的编辑视图，
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
  const draft = useWorkspace((s) => (s.editing?.pageId === page.id ? s.editing.config : null));
  const startEditing = useWorkspace((s) => s.startEditing);
  const shown = draft?.pages.find((p) => p.id === page.id) ?? page;
  const { edit, finish, cancel } = useEditActions(shown);
  const [selected, setSelected] = useState<string | null>(null);

  const sheet = (
    <EditSheet
      page={shown}
      componentId={selected}
      palette={env.palette}
      onClose={() => setSelected(null)}
    />
  );

  if (draft) {
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
        page={page}
        env={{
          ...env,
          edit: (id) => {
            startEditing(page.id);
            setSelected(id);
          },
        }}
        bottomInset={bottomInset}
        scroll={rememberScroll(page.id)}
      />
      {sheet}
    </>
  );
}
