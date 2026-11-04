import {
  contactActions,
  recordToVCard,
  type Collection,
  type FieldLink,
  type Locale,
  type StringKey,
} from '@morph/core';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { useWorkspaceContext } from '../workspace/context';
import { UiIcon, type UiIconName } from './Icon';
import { openFieldLink } from './open-link';
import type { Palette } from './theme';

// 已有记录的记录页顶部的一排按钮（D-423，取代 D-422 框下面的一行）：只看字段的 format，和表是什么无关。
// 看的是框里现在的值。打开、分享都是用户亲手点的（底线 10），什么都不写（底线 15）。

export function RecordActionRow({
  collection,
  values,
  palette,
}: {
  collection: Collection;
  values: Readonly<Record<string, unknown>>;
  palette: Palette;
}) {
  const { files, locale } = useWorkspaceContext();
  const actions = contactActions(collection.fields, values);
  const items: { id: string; label: StringKey; icon: UiIconName; press: () => void }[] = [];
  const add = (id: string, label: StringKey, icon: UiIconName, press: () => void) =>
    items.push({ id, label, icon, press });
  const link = (
    id: string,
    label: StringKey,
    icon: UiIconName,
    kind: FieldLink['kind'],
    url: string | null,
  ) => {
    if (url) add(id, label, icon, () => openFieldLink({ kind, url }, locale));
  };
  link('call', 'recordCall', 'phone', 'phone', actions.call);
  link('message', 'recordMessage', 'message', 'message', actions.message);
  link('email', 'recordEmail', 'mail', 'email', actions.email);
  link('website', 'recordWebsite', 'globe', 'url', actions.website);
  if (actions.shareCard)
    add('share', 'recordShareCard', 'share', () => shareCard(files, collection, values, locale));
  if (items.length === 0) return null;
  return (
    <View testID="record-actions" style={styles.row}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          testID={`record-action-${item.id}`}
          accessibilityRole="button"
          onPress={item.press}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}>
          <UiIcon name={item.icon} size={22} color={palette.primaryText} />
          <Text
            numberOfLines={2}
            style={[palette.font('bodyMedium', 12), styles.label, { color: palette.primaryText }]}>
            {t(locale, item.label)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function shareCard(
  files: { shareText(name: string, text: string, mimeType: string): Promise<void> },
  collection: Collection,
  values: Readonly<Record<string, unknown>>,
  locale: Locale,
) {
  const text = recordToVCard(collection.fields, values);
  if (!text) return;
  // 文件名固定：记录里的文字可能有路径里不能有的字符。
  void files
    .shareText('contact.vcf', text, 'text/vcard')
    .catch(() => Alert.alert(t(locale, 'openLinkFailed')));
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  action: {
    flexGrow: 1,
    flexBasis: 56,
    minHeight: 56,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  label: { textAlign: 'center' },
});
