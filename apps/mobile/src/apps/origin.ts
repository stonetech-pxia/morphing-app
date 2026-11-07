import { readAppFile, type AppFile } from '@morph/core';

import type { WorkspaceRepo } from '../storage/types';

// 导入的 App 的原文件（D-485）：只存在本机的 app_meta 里，不进配置、不发给 AI，用来「恢复初始样子」。
// 不是从文件导入的 App（Tink 或自己搭的）没有原文件，也就没有「恢复初始样子」。

type Meta = Pick<WorkspaceRepo, 'getMeta' | 'setMeta'>;
const key = (appId: string) => `app.origin.${appId}`;

export async function saveAppOrigin(repo: Meta, appId: string, text: string): Promise<void> {
  await repo.setMeta(key(appId), text);
}

export async function loadAppOrigin(repo: Meta, appId: string): Promise<AppFile | null> {
  const text = await repo.getMeta(key(appId));
  return text ? readAppFile(text) : null;
}
