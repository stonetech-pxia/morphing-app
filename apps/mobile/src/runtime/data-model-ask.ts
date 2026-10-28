import type { Locale } from '@morph/core';
import { Alert } from 'react-native';

import { t } from '@/i18n';

/** 下载日期和金额识别模型之前问用户（prepareDataDetection 的 ask）。 */
export function askDataModelDownload(locale: Locale): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      t(locale, 'dataModelDownloadAsk'),
      t(locale, 'dataModelDownloadBody'),
      [
        { text: t(locale, 'cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t(locale, 'dataModelDownload'), onPress: () => resolve(true) },
      ],
      // Android 点对话框外面关掉时也要有答案，不然一直等。
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
