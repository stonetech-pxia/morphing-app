import { linkTarget, type FieldLink, type Locale } from '@morph/core';
import { Alert, Linking } from 'react-native';

import { t } from '../i18n';

/** 打开 App 外的网址前先问，写明目标地址（D-044）。open 是用户点了「打开」才调用。 */
export function confirmOpenLink(locale: Locale, url: string, open: () => void): void {
  Alert.alert(
    t(locale, 'openLinkTitle'),
    t(locale, 'openLinkMessage', { target: linkTarget(url) }),
    [
      { text: t(locale, 'cancel'), style: 'cancel' },
      { text: t(locale, 'openLink'), onPress: open },
    ],
  );
}

/**
 * 记录页上点电话、邮箱、网址（D-422）。电话、邮箱交给系统的拨号和写信页面，什么都没发出去，直接打开；
 * 网址先问。不写数据。不用 canOpenURL（要声明白名单）：打不开时说一句（没有电话或邮件 App 的设备）。
 */
export function openFieldLink(link: FieldLink, locale: Locale): void {
  const open = () =>
    void Linking.openURL(link.url).catch(() => Alert.alert(t(locale, 'openLinkFailed')));
  if (link.kind === 'url') confirmOpenLink(locale, link.url, open);
  else open();
}
