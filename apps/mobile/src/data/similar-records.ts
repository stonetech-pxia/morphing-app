import { findSimilarRecords, prepareRecordValues, recordTitle, type Collection } from '@morph/core';
import { useRef } from 'react';
import { Alert } from 'react-native';

import { t } from '../i18n';
import { useCalendar, useWorkspaceContext } from '../workspace/context';

// 保存新记录前问一句（D-426）：表上有 prefillRules、而且有看起来一样的记录时才问。只读，只在点保存时读记录，
// 打字不受影响；只在本机。总能选「仍然保存」（底线 19），不合并、不删除任何记录（底线 5）。

/** 返回一个函数：可以接着存时 true；用户选回到表单（或正在问）时 false。 */
export function useSimilarCheck() {
  const { repo, locale } = useWorkspaceContext();
  const cal = useCalendar();
  // 连点两下保存：第一下还在问的时候，第二下什么都不做。
  const asking = useRef(false);
  return async function mayProceed(
    collection: Collection,
    input: Record<string, unknown>,
  ): Promise<boolean> {
    if (!collection.prefillRules) return true;
    if (asking.current) return false;
    asking.current = true;
    try {
      const now = new Date();
      const prepared = prepareRecordValues(collection, input, null, now, cal);
      // 校验不过：接着走，保存那一步会说哪里不对。
      if (!prepared.ok) return true;
      // 读不了记录也不挡保存。
      const records = await repo.listRecords(collection.id).catch(() => []);
      const similar = findSimilarRecords(collection, prepared.values, records);
      const first = similar[0];
      if (!first) return true;
      const title = recordTitle(first, collection, locale, now, cal);
      const message =
        similar.length === 1
          ? t(locale, 'similarRecordOne', { title, table: collection.name })
          : t(locale, 'similarRecordMany', {
              title,
              table: collection.name,
              n: similar.length - 1,
            });
      return await new Promise<boolean>((resolve) => {
        Alert.alert(
          t(locale, 'similarRecordTitle'),
          message,
          [
            {
              text: t(locale, 'similarRecordBack'),
              style: 'cancel',
              onPress: () => resolve(false),
            },
            { text: t(locale, 'similarRecordSave'), onPress: () => resolve(true) },
          ],
          // Android 点外面关掉：回到表单，不会卡住。
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
    } finally {
      asking.current = false;
    }
  };
}
