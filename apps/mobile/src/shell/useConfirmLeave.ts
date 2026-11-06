import type { Locale } from '@morph/core';
import { usePreventRemove, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { t, type StringKey } from '../i18n';

/**
 * 有没保存的改动时，返回（按钮、手势）前先问「放弃修改？」（2026-11-06 测试：新记录表单、桌上的修改，
 * 返回就悄悄没了）。返回的 leave() 用在保存、删除以后：不问，直接返回。
 */
export function useConfirmLeave(unsaved: boolean, message: StringKey, locale: Locale) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const disable = usePreventRemove(unsaved && !leaving, ({ repeat }) => {
    Alert.alert(t(locale, 'discardTitle'), t(locale, message), [
      { text: t(locale, 'keepEditing'), style: 'cancel' },
      {
        text: t(locale, 'discard'),
        style: 'destructive',
        onPress: () => {
          setLeaving(true);
          repeat();
        },
      },
    ]);
  });
  return () => {
    setLeaving(true);
    disable();
    router.back();
  };
}
