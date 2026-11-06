import { MAX_ATTACHMENTS, MEDIA_LIMITS, type Locale } from '@morph/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { IMPORT_PROBLEMS } from '../renderer/Attachments';
import type { Palette } from '../renderer/theme';
import { copyUserFiles } from '../renderer/slot-file';
import { recordTargets } from '../runtime/actions/records';
import type { PickedFile } from '../runtime/platform';
import { useReceiptLike } from './receipt-like';
import { deleteUserFiles } from '../storage/user-files';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { holdFormCopies, recordChoices, type RecordChoice } from './save-as-record';

/**
 * 存成记录（D-392，创始人 2026-10-31 在对话里选定）：收到的文件复制成用户文件（收件这一批照旧，离开收件页面
 * 时释放）。放进已有的表：打开新记录表单，附件已经放好。新建：打开新建表单页，点「记下」才建表（D-444）。
 * 没保存就离开时，下一页删掉这些副本。收件页面和预览页（D-457）共用。
 */
export function useSaveAsRecord(picked: readonly PickedFile[], onDone: () => void) {
  const { repo, files, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const router = useRouter();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveAsRecord(choice: RecordChoice | null) {
    if (placing) return;
    setPlacing(true);
    setError(null);
    let copied: string[] = [];
    try {
      const result = await copyUserFiles(picked.slice(0, MAX_ATTACHMENTS), files, repo);
      // 打开、分享时已经存进文档库的不算副本（D-455）：放弃时只删这一次新复制的。
      copied = result.created;
      const attached = result.assetIds;
      if (result.problem) {
        setError(
          t(locale, IMPORT_PROBLEMS[result.problem], {
            gb: MEDIA_LIMITS.maxFileBytes / 1024 / 1024 / 1024,
          }),
        );
        return;
      }
      if (!choice) {
        const ids = copied;
        copied = [];
        bumpAssets();
        onDone();
        router.push({
          pathname: '/new-table',
          params: { copies: holdFormCopies(ids), attached: JSON.stringify(attached) },
        });
        return;
      }
      const table = config.data.tables.find((c) => c.id === choice.tableId);
      const field = table && recordTargets(table).fileField;
      if (!table || !field) return;
      const ids = copied;
      copied = [];
      bumpAssets();
      onDone();
      router.push({
        pathname: '/record/[collectionId]',
        params: {
          collectionId: table.id,
          prefill: JSON.stringify({ [field]: attached }),
          copies: holdFormCopies(ids),
        },
      });
    } catch (e) {
      setError(String(e));
    } finally {
      // 没交给下一页的副本不留下。
      if (copied.length > 0) await deleteUserFiles(copied, repo, files).catch(() => undefined);
      setPlacing(false);
    }
  }

  return { placing, error, saveAsRecord };
}

/** 存成记录的列表：「新建表单」在最前（表多了不用滚动），再是有附件字段的表。 */
export function RecordChooser({
  count,
  files,
  placing,
  palette,
  locale,
  onChoose,
}: {
  count: number;
  /** 收到的文件：在本机读文字，像收据时推荐带收据规则的表（D-476）。 */
  files: readonly PickedFile[];
  placing: boolean;
  palette: Palette;
  locale: Locale;
  onChoose: (choice: RecordChoice | null) => void;
}) {
  const config = useWorkspace((s) => s.config)!;
  const caption = [palette.font('body', 13), { color: palette.muted }];
  const hasReceiptTable = recordChoices(config).some(
    (c) => config.data.tables.find((x) => x.id === c.tableId)?.prefillRules === 'receipt',
  );
  const tables = recordChoices(config, useReceiptLike(files, hasReceiptTable));
  const row = (id: string, name: string, about: string | null, choice: RecordChoice | null) => (
    <Pressable
      key={id}
      testID={id}
      accessibilityRole="button"
      disabled={placing}
      onPress={() => onChoose(choice)}
      style={({ pressed }) => [styles.choice, (pressed || placing) && { opacity: 0.6 }]}>
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[palette.font('bodyMedium', 15), { color: palette.text }]}>
          {name}
        </Text>
        {about ? <Text style={caption}>{about}</Text> : null}
      </View>
      <Text style={[palette.font('title', 18), { color: palette.caption }]}>›</Text>
    </Pressable>
  );
  return (
    <View testID="share-record-list" style={styles.chooser}>
      {count > MAX_ATTACHMENTS ? (
        <Text testID="share-record-too-many" style={caption}>
          {t(locale, 'shareRecordTooMany', { n: MAX_ATTACHMENTS })}
        </Text>
      ) : null}
      {row('share-record-new', t(locale, 'shareRecordNew'), t(locale, 'shareRecordNewAbout'), null)}
      {tables.length > 0 ? (
        <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
          {t(locale, 'shareRecordTables')}
        </Text>
      ) : null}
      {tables.map((c) =>
        row(
          `share-record-table-${c.tableId}`,
          c.name,
          c.recommended ? t(locale, 'shareRecordLooksLikeReceipt') : null,
          c,
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chooser: { gap: 4, paddingBottom: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingLeft: 8 },
});
