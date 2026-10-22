import type { Op, Page } from '@morph/core';
import { useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewProps } from 'react-native';

import { PageView, type RenderEnv } from '../renderer/components';
import { useWorkspace } from '../workspace/context';
import { useEditActions } from './actions';
import { ArrangeView } from './ArrangeView';
import { EditSheet } from './EditSheet';

// 可以直接编辑的页面（D-052）：外壳和独立页面用它代替 PageView。
// 长按组件打开操作面板；「调整顺序」时换成带把手和箭头的编辑视图。预览和系统页面不用它。

/** 每次修改都会生成新版本并重新挂载页面；记住滚动位置，改完仍停在原处。 */
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
  const arranging = useWorkspace((s) => s.arranging === page.id);
  const setArranging = useWorkspace((s) => s.setArranging);
  const { run } = useEditActions(page);
  const [selected, setSelected] = useState<string | null>(null);

  const sheet = (
    <EditSheet
      page={page}
      componentId={selected}
      palette={env.palette}
      onClose={() => setSelected(null)}
    />
  );

  if (arranging) {
    return (
      <>
        <ArrangeView
          page={page}
          env={env}
          bottomInset={bottomInset}
          scroll={rememberScroll(`${page.id}:arrange`)}
          onEdit={setSelected}
          onMove={(op: Op, id: string) => void run([op], 'moveSummary', id)}
          onDone={() => setArranging(null)}
        />
        {sheet}
      </>
    );
  }
  return (
    <>
      <PageView
        page={page}
        env={{ ...env, edit: setSelected }}
        bottomInset={bottomInset}
        scroll={rememberScroll(page.id)}
      />
      {sheet}
    </>
  );
}
