import { canSavePreset, presetName, presetSnapshot } from '@morph/core';

import { newAssetId } from '../../runtime/runner';
import type { Kernel } from './kernel';
import type { WorkspaceState } from './types';

// 保存的预设（D-410）：只在本机数据库里，存、改名、删除都不产生版本，也不发给 AI。应用见 revisions.ts。

export function createPresets({
  repo,
  deps,
  msg,
  set,
  get,
}: Kernel): Pick<WorkspaceState, 'savePreset' | 'renamePreset' | 'deletePreset' | 'restorePreset'> {
  const bump = () => set({ presetsVersion: get().presetsVersion + 1 });
  return {
    async savePreset(rawName) {
      const { config } = get();
      if (!config) throw new Error('workspace not loaded');
      const name = presetName(rawName);
      if (!name) return { kind: 'noName' };
      if (!canSavePreset((await repo.listPresets()).length)) return { kind: 'full' };
      const preset = {
        id: newAssetId(),
        name,
        createdAt: deps.now().getTime(),
        schemaVersion: config.schemaVersion,
        config: presetSnapshot(config),
      };
      await repo.insertPreset(preset);
      // 撤销删除会多放回一个，存之前先让那个撤销过期，总数不会超过上限。
      if (get().toast?.restorePreset) set({ toast: null });
      bump();
      return { kind: 'saved', preset };
    },

    async renamePreset(id, rawName) {
      const name = presetName(rawName);
      if (!name) return false;
      await repo.renamePreset(id, name);
      bump();
      return true;
    },

    async deletePreset(preset) {
      await repo.deletePreset(preset.id);
      set({
        toast: { message: msg('presetDeleted', { name: preset.name }), restorePreset: preset },
      });
      bump();
    },

    async restorePreset(preset) {
      await repo.insertPreset(preset);
      bump();
    },
  };
}
