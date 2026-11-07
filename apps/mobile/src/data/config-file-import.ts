import { MAX_APP_CONFIG_SIZE, type AppConfigFileProblem, type Locale } from '@morph/core';

import { t } from '@/i18n';
import type { FilePlatform } from '../runtime/platform';

// 「我的预设 → 从文件导入」（D-485）用：选一个 JSON 文件、读成文字、把读不了的原因翻成人话。
// 全程在本机，不联网，文件内容不发给 AI（底线 1、2）。

/** 读不了这个文件的原因，用户看得懂的话。 */
export function configFileProblemText(locale: Locale, problem: AppConfigFileProblem): string {
  switch (problem) {
    case 'tooLarge':
      return t(locale, 'importAppConfigTooLarge', { max: MAX_APP_CONFIG_SIZE / 1_000_000 });
    case 'notJson':
      return t(locale, 'importAppConfigNotJson');
    case 'newerApp':
      return t(locale, 'importAppConfigNewer');
    case 'wrongFormat':
      return t(locale, 'importAppConfigInvalid');
  }
}

export type PickedConfigText =
  /** 用户没选。 */
  | { kind: 'cancelled' }
  /** 选了，但读不了：problem 说原因。 */
  | { kind: 'refused'; problem: AppConfigFileProblem }
  | { kind: 'text'; text: string; fileName: string };

/**
 * 用系统文件选择器选一个配置文件并读出文字。太大的不读进内存（大小已知时先比），
 * 选择器放在缓存里的副本不管读没读都删掉；用户的原件不碰（AGENTS.md 文件的归属）。
 */
export async function pickConfigText(files: FilePlatform): Promise<PickedConfigText> {
  const picked = await files.pickDocuments(['application/json', 'text/plain'], false);
  const file = picked?.[0];
  if (!file) return { kind: 'cancelled' };
  if (file.size !== null && file.size > MAX_APP_CONFIG_SIZE) {
    await files.removePickedCopies([file.uri]);
    return { kind: 'refused', problem: 'tooLarge' };
  }
  try {
    return { kind: 'text', text: await files.readPickedText(file.uri), fileName: file.name };
  } catch {
    await files.removePickedCopies([file.uri]);
    return { kind: 'refused', problem: 'wrongFormat' };
  }
}
