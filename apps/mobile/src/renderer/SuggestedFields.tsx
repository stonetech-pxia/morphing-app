import type { Collection, FieldIssue, Locale } from '@morph/core';
import type { ComponentProps } from 'react';
import { Text, View } from 'react-native';

import { useFieldSuggestions } from '../data/field-suggestions';
import { t } from '../i18n';
import { PackGate } from '../packs/PackGate';
import { usePacks } from '../packs/PackHost';
import { FieldsForm } from './data';
import type { Palette } from './theme';
import { Pill } from './ui';

// 新记录表单的字段（D-394、D-397）：记录页和快捷操作的「记一笔」用同一份。附件里的照片、PDF 由表单自己读，
// 给每个空字段候选，点了才填；快捷操作的步骤里不用写识别文字。表关掉 readAttachments 时不读。

export function SuggestedFields({
  suggest: enabled,
  collection,
  values,
  onChange,
  issues,
  palette,
  locale,
  testPrefix,
  related,
}: {
  /** 只有新记录的表单给候选（编辑已有的记录不给）。 */
  suggest: boolean;
  collection: Collection;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  issues: FieldIssue[];
  palette: Palette;
  locale: Locale;
  testPrefix: string;
  related?: ComponentProps<typeof FieldsForm>['related'];
}) {
  const packs = usePacks();
  const suggest = useFieldSuggestions({ enabled, collection, values, locale });
  return (
    <>
      {suggest.missing.length > 0 && packs ? (
        <View testID="suggestions-notice" style={{ gap: 8, alignItems: 'flex-start' }}>
          <Text style={[palette.font('body', 14), { color: palette.muted }]}>
            {t(locale, 'suggestionsNeedDownload')}
          </Text>
          <Pill
            palette={palette}
            testID="suggestions-download"
            label={t(locale, 'suggestionsDownload')}
            onPress={suggest.ask}
          />
        </View>
      ) : null}
      {suggest.working ? (
        <Text
          testID="suggestions-working"
          style={[palette.font('body', 13), { color: palette.caption }]}>
          {t(locale, 'suggestionsWorking')}
        </Text>
      ) : null}
      <FieldsForm
        collection={collection}
        fieldIds={collection.fields.map((f) => f.id)}
        values={values}
        onChange={onChange}
        {...(enabled ? { suggestions: suggest.suggestions } : {})}
        onSuggestion={suggest.remember}
        issues={issues}
        palette={palette}
        locale={locale}
        testPrefix={testPrefix}
        {...(related !== undefined ? { related } : {})}
      />
      {suggest.asking && packs ? (
        <PackGate
          needs={suggest.asking}
          store={packs.store}
          palette={palette}
          locale={locale}
          onDone={suggest.answered}
        />
      ) : null}
    </>
  );
}
