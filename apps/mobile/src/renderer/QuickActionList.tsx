import type { BlockOf } from '@morph/core';

import { WorkflowsScreen } from '../shell/WorkflowsScreen';
import type { RenderEnv } from './components';

/**
 * 快捷操作目录（look library，原 quickActionList，D-230）：把「Morph 可以做什么」的分类入口，或某一类的快捷操作，放到页面上。
 * 内容和固定页面一样由内核决定；草稿和预览里不能点（草稿里点了提示先应用）。
 */
export function QuickActionList({ block, env }: { block: BlockOf<'library'>; env: RenderEnv }) {
  return (
    <WorkflowsScreen
      palette={env.palette}
      locale={env.locale}
      registry={env.registry}
      kind={block.source.kind}
      inPage={{
        title: block.show?.title,
        guard: () => {
          if (env.locked) {
            env.locked();
            return true;
          }
          return !env.interactive;
        },
      }}
    />
  );
}
