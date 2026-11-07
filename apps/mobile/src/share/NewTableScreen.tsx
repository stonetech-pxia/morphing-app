import {
  addDraftField,
  attachmentIds,
  draftEngine,
  draftReceiptSample,
  draftHasField,
  draftTable,
  draftTableOps,
  extractFieldNames,
  fieldNameFromText,
  looksLikeValue,
  originalRows,
  PREFILL_MODEL_PACK,
  rankPresets,
  recommendPreset,
  rulePreset,
  removeDraftField,
  renameDraftField,
  sampleInfo,
  templateTableName,
  templateTableOf,
  type Collection,
  type FieldIssue,
  type NewPreset,
  type NewTablePreset,
  type TextPage,
} from '@morph/core';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useRecordActions } from '../data/records';
import { t } from '../i18n';
import { PackGate } from '../packs/PackGate';
import { usePacks } from '../packs/PackHost';
import { FormFilesContext } from '../renderer/Attachments';
import { SuggestedFields } from '../renderer/SuggestedFields';
import { usePalette } from '../renderer/theme';
import { Button, Pill } from '../renderer/ui';
import { deviceFitsLocalModel, openLocalModel } from '../runtime/local-model';
import { aboutParams } from '../shell/ai-entry';
import { deleteUserFiles } from '../storage/user-files';
import { useWorkspace, useWorkspaceContext, useAppTheme } from '../workspace/context';
import { holdFormCopies, takeFormCopies } from './save-as-record';

// 导入文件后新建表单（D-444，创始人 2026-11-05 在对话里定）：匹配到预设和没匹配到是同一个页面，只是一开始的字段不同。
// 规则给预设排序；本机 2B 算完只显示一行推荐，不移动别的东西，用户点了才用。候选值只用规则，点了才填（D-394）。
// 表在点「记下」时才建，之前什么都不写（底线 15）。文字和字段名选项只在本机（底线 1、2）；Tink 只看建好的表结构。

function keepFor(next: Collection, prev: Collection): Collection {
  const added = prev.fields.filter((f) => f.id.startsWith('field-'));
  const at = next.fields.findIndex((f) => f.type === 'file');
  const fields = [...next.fields];
  fields.splice(at < 0 ? fields.length : at, 0, ...added);
  return { ...next, fields };
}

export function NewTableScreen() {
  const { copies, attached } = useLocalSearchParams<{ copies?: string; attached?: string }>();
  const { repo, files, locale } = useWorkspaceContext();
  const router = useRouter();
  const config = useWorkspace((s) => s.config)!;
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const palette = usePalette(useAppTheme(config));
  const actions = useRecordActions();
  const headerHeight = useHeaderHeight();
  const packs = usePacks();

  const [copied] = useState(() => takeFormCopies(copies));
  // 要附上的文件：这一次新复制的，加上打开时已经存进文档库的（D-455，那些不是这一页的副本，放弃时不删）。
  const [attachedIds] = useState(() => {
    try {
      const ids: unknown = attached ? JSON.parse(attached) : null;
      return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : copied;
    } catch {
      return copied;
    }
  });
  const [preset, setPreset] = useState<NewPreset>('blank');
  const [draft, setDraft] = useState<Collection>(() => draftTable('blank', config, locale));
  const fileField = (table: Collection) => table.fields.find((f) => f.type === 'file')?.id ?? '';
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    [fileField(draftTable('blank', config, locale))]: attachedIds,
  }));
  const [pages, setPages] = useState<TextPage[]>([]);
  // 推荐的类型：规则的是读出的文字（pages）算出来的，本机模型的答案另存、带着它回答的那批文字；
  // 用户自己选过类型、或者换了文件（pages 变了），旧答案和旧推荐都不再用。
  const ruled = useMemo(() => (pages.length === 0 ? null : rulePreset(pages)), [pages]);
  const [modelPick, setModelPick] = useState<{
    pages: TextPage[];
    preset: NewTablePreset | null;
  } | null>(null);
  const [chosenFor, setChosenFor] = useState<TextPage[] | null>(null);
  const recommended: NewTablePreset | null =
    chosenFor === pages ? null : ((modelPick?.pages === pages ? modelPick.preset : null) ?? ruled);
  const [working, setWorking] = useState(false);
  // 手机能用本机模型却还没下载：问一次要不要下载（点了才下，D-064），下完重新判断。
  const [modelMissing, setModelMissing] = useState(false);
  const [askingModel, setAskingModel] = useState(false);
  const [installs, setInstalls] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [valueHint, setValueHint] = useState(false);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 表建好了（记录没存成、要接着改）：再点「记下」只存记录。
  const created = useRef<Collection | null>(null);

  // 离开时没存进记录、也没交给下一页的文件删掉（和记录页一样）。
  const owned = useRef<Set<string>>(new Set(copied));
  const [formFiles] = useState(() => ({
    hold: (ids: readonly string[]) => ids.forEach((id) => owned.current.add(id)),
  }));
  useEffect(
    () => () => {
      const unused = [...owned.current];
      if (unused.length === 0) return;
      void deleteUserFiles(unused, repo, files)
        .then(bumpAssets)
        .catch(() => undefined);
    },
    [repo, files, bumpAssets],
  );

  // 读出文字后问一次本机模型；模型没装、内存不够就不显示「正在判断」。
  // 很明显的小票先由规则推荐（没有模型也有）；模型有答案时换成模型的，没有答案时规则的留着。
  const store = packs?.store;
  useEffect(() => {
    if (pages.length === 0) return;
    if (!store) return;
    const abort = new AbortController();
    void (async () => {
      if (!deviceFitsLocalModel()) return;
      if (!(await store.isInstalled(PREFILL_MODEL_PACK))) {
        if (!abort.signal.aborted) setModelMissing(!!process.env.EXPO_PUBLIC_MORPH_PACKS_URL);
        return;
      }
      if (abort.signal.aborted) return;
      setModelMissing(false);
      setWorking(true);
      const got = await recommendPreset(openLocalModel(store), pages, abort.signal);
      if (abort.signal.aborted) return;
      setModelPick({ pages, preset: got });
      setWorking(false);
    })();
    return () => abort.abort();
  }, [store, pages, installs]);

  const ranking = useMemo(() => rankPresets(pages), [pages]);
  const names = useMemo(() => extractFieldNames(pages), [pages]);
  const rows = useMemo(() => originalRows(pages), [pages]);
  const offered = names.filter((n) => !draftHasField(draft, n));
  // 文件里认出的字段名多时先显示前几个，其余点「展开」看。
  const [allNames, setAllNames] = useState(false);
  const shownNames = allNames ? offered : offered.slice(0, FIRST_NAMES);
  // 推荐购物凭证时，已经有带收据规则的表（例如样板「收据」，D-421）就放进那张，不再建第二张（D-477）。
  const receiptTable = config.data.tables.find(
    (c) => c.prefillRules === 'receipt' && c.fields.some((f) => f.type === 'file'),
  )?.id;
  const existing = recommended
    ? (templateTableOf(recommended, config) ??
      (recommended === 'purchase' ? receiptTable : undefined))
    : undefined;
  const open = (p: NewTablePreset) => templateTableOf(p, config) === undefined;

  const text = [palette.font('body', 14), { color: palette.text }];
  const muted = [palette.font('body', 13), { color: palette.muted }];
  const label = [palette.font('bodyBold', 13), { color: palette.muted }];
  const input = [
    palette.font('body', 15),
    styles.input,
    { color: palette.text, borderColor: palette.border, backgroundColor: palette.card },
  ];

  function choose(next: NewPreset) {
    const made = keepFor(draftTable(next, config, locale), draft);
    // 购物凭证建的是整套「收据」（D-479）：表名先写成「收据」，建出来的就是这个名字。
    const table =
      next === 'purchase' && made.name === templateTableName('purchase', locale)
        ? { ...made, name: sampleInfo('receipts', locale).name }
        : made;
    // 同样的字段留着已经填的值；文件搬到新表的附件字段。
    const kept = Object.fromEntries(
      table.fields.flatMap((f) =>
        f.type !== 'file' && values[f.id] !== undefined ? [[f.id, values[f.id]] as const] : [],
      ),
    );
    setValues({ ...kept, [fileField(table)]: attachmentIds(values[fileField(draft)]) });
    setDraft(table);
    setPreset(next);
    setChoosing(false);
    setChosenFor(pages);
  }

  function addField(name: string) {
    setDraft((d) => addDraftField(d, name, pages, locale));
  }

  function addOriginal() {
    const name = fieldNameFromText(selected.join(' '));
    setSelected([]);
    if (looksLikeValue(name)) {
      // 点到的是值：不把它当字段名（配置里不放值，底线 14），请用户起一个。
      setAdding(true);
      setValueHint(true);
      return;
    }
    addField(name);
  }

  /** 建表（用户的一次修改，能撤销）。 */
  async function createTable(): Promise<Collection | null> {
    if (created.current) return created.current;
    const fallback =
      preset === 'blank'
        ? draftTable('blank', config, locale).name
        : templateTableName(preset, locale);
    const typed = { ...draft, name: draft.name.trim() || fallback };
    // 选了购物凭证又没改字段和表名：建整套「收据」（D-479），记录放进它建出来的那张表。
    const sample = draftReceiptSample(typed, preset, config, locale);
    const table = sample ? sample.table : typed;
    const proposed = await proposeOps(
      sample ? sample.ops : draftTableOps(table, preset, config, locale),
      t(locale, 'shareRecordNewTable', { name: table.name }),
    );
    if (proposed.kind !== 'preview') {
      setMessage(proposed.kind === 'rejected' ? proposed.message : proposed.issues.join('\n'));
      return null;
    }
    if (!(await confirm())) return null;
    created.current = table;
    return table;
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const table = await createTable();
      if (!table) return;
      const result = await actions.add(table, values);
      if (result.ok) {
        const keep = new Set(attachmentIds(values[fileField(table)]));
        owned.current = new Set([...owned.current].filter((id) => !keep.has(id)));
        router.back();
      } else if ('issues' in result) setIssues(result.issues);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 把文件交给记录页（下一页负责没保存时删掉）。 */
  function handOff(table: Collection, field: string, extra: Record<string, unknown>) {
    const ids = attachmentIds(values[fileField(draft)]);
    // 只把这一页的副本交给记录页（打开时已经在文档库的不算，D-455）。
    const mine = ids.filter((id) => owned.current.has(id));
    owned.current = new Set();
    router.replace({
      pathname: '/record/[collectionId]',
      params: {
        collectionId: table.id,
        prefill: JSON.stringify({ ...extra, [field]: ids }),
        copies: holdFormCopies(mine),
      },
    });
  }

  function putInExisting() {
    const table = config.data.tables.find((c) => c.id === existing);
    if (table) handOff(table, fileField(table), {});
  }

  /** Tink 改的是建好的表（只看结构，看不到文件，底线 2）：先建表，表单换成记录页，再打开 AI 页。 */
  async function askTink() {
    if (busy) return;
    setBusy(true);
    try {
      const table = await createTable();
      if (!table) return;
      const typed = Object.fromEntries(
        Object.entries(values).filter(([k]) => k !== fileField(table)),
      );
      handOff(table, fileField(table), typed);
      router.push({
        pathname: '/change',
        params: aboutParams({ kind: 'table', tableId: table.id }),
      });
    } finally {
      setBusy(false);
    }
  }

  const typeRow = (p: NewPreset) => (
    <Pressable
      key={p}
      testID={`new-table-type-${p}`}
      accessibilityRole="button"
      onPress={() => choose(p)}
      style={styles.row}>
      <Text style={[palette.font('bodyMedium', 15), { color: palette.text }]}>
        {p === 'blank' ? t(locale, 'newTableBlank') : templateTableName(p, locale)}
      </Text>
    </Pressable>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.background }}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}>
      <Stack.Screen options={{ title: t(locale, 'newTableTitle') }} />
      <ScrollView
        testID="new-table-screen"
        contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled">
        {working ? (
          <Text testID="new-table-working" style={muted}>
            {t(locale, 'newTableWorking')}
          </Text>
        ) : null}
        {modelMissing && !recommended && !working ? (
          <View testID="new-table-model-need" style={{ gap: 8, alignItems: 'flex-start' }}>
            <Text style={muted}>{t(locale, 'newTableModelNeed')}</Text>
            <Pill
              palette={palette}
              testID="new-table-model-download"
              label={t(locale, 'localModelDownload')}
              onPress={() => setAskingModel(true)}
            />
          </View>
        ) : null}
        {askingModel && packs ? (
          <PackGate
            needs={[{ pack: PREFILL_MODEL_PACK, optional: false }]}
            store={packs.store}
            palette={palette}
            locale={locale}
            onDone={(left) => {
              setAskingModel(false);
              if (left !== null) setInstalls((n) => n + 1);
            }}
          />
        ) : null}
        {recommended && !existing ? (
          <View testID="new-table-recommend" style={styles.wrap}>
            <Text style={text}>
              {t(locale, 'newTableLooksLike', { name: templateTableName(recommended, locale) })}
            </Text>
            <Pill
              palette={palette}
              testID="new-table-use"
              label={t(locale, 'newTableUse')}
              onPress={() => choose(recommended)}
            />
          </View>
        ) : null}
        {recommended && existing ? (
          <Pill
            palette={palette}
            testID="new-table-use-existing"
            label={t(locale, 'newTableUseExisting', {
              name: config.data.tables.find((c) => c.id === existing)?.name ?? '',
            })}
            onPress={putInExisting}
          />
        ) : null}

        <View style={styles.wrap}>
          <TextInput
            testID="new-table-name"
            accessibilityLabel={t(locale, 'newTableName')}
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            style={[input, styles.flex]}
          />
          <Pill
            palette={palette}
            testID="new-table-change-type"
            label={t(locale, 'newTableType')}
            onPress={() => setChoosing((v) => !v)}
          />
        </View>
        {choosing ? (
          <View testID="new-table-types">
            {ranking.likely.filter(open).map(typeRow)}
            {typeRow('blank')}
            {ranking.unlikely.filter(open).length > 0 ? (
              <>
                <Text style={[label, styles.gapTop]}>{t(locale, 'newTableOtherTypes')}</Text>
                {ranking.unlikely.filter(open).map(typeRow)}
              </>
            ) : null}
          </View>
        ) : null}

        {editing ? (
          <View testID="new-table-fields" style={{ gap: 8 }}>
            {draft.fields
              .filter((f) => f.type !== 'file')
              .map((f) => (
                <View key={f.id} style={styles.wrap}>
                  <TextInput
                    testID={`new-table-field-name-${f.id}`}
                    defaultValue={f.name}
                    onEndEditing={(e) => {
                      const name = e.nativeEvent.text;
                      setDraft((d) => renameDraftField(d, f.id, name));
                    }}
                    style={[input, styles.flex]}
                  />
                  <Pressable
                    testID={`new-table-field-remove-${f.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t(locale, 'newTableRemoveField', { name: f.name })}
                    onPress={() => setDraft((d) => removeDraftField(d, f.id))}
                    style={styles.remove}>
                    <Text style={[palette.font('title', 18), { color: palette.muted }]}>×</Text>
                  </Pressable>
                </View>
              ))}
          </View>
        ) : null}

        {/* 改字段时藏起来，不卸载：卸载了要重新认一遍字。 */}
        <View style={editing ? styles.hidden : styles.form}>
          <FormFilesContext.Provider value={formFiles}>
            <SuggestedFields
              suggest
              engine={draftEngine}
              onPages={setPages}
              collection={draft}
              values={values}
              onChange={setValues}
              issues={issues}
              palette={palette}
              locale={locale}
              testPrefix="draft"
            />
          </FormFilesContext.Provider>
        </View>

        {offered.length > 0 ? (
          <View testID="new-table-in-file" style={{ gap: 8 }}>
            <Text style={label}>{t(locale, 'newTableInFile')}</Text>
            <View style={styles.wrap}>
              {shownNames.map((name, i) => (
                <Pill
                  key={name}
                  palette={palette}
                  testID={`new-table-chip-${i}`}
                  label={`+ ${name}`}
                  onPress={() => addField(name)}
                />
              ))}
            </View>
            {offered.length > FIRST_NAMES ? (
              <Pressable
                testID="new-table-in-file-toggle"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setAllNames((v) => !v)}>
                <Text style={[palette.font('bodyBold', 13), { color: palette.primaryText }]}>
                  {t(locale, allNames ? 'newTableNamesLess' : 'newTableNamesMore')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.wrap}>
          <Pill
            palette={palette}
            testID="new-table-edit"
            label={t(locale, editing ? 'newTableEditDone' : 'newTableEditFields')}
            onPress={() => setEditing((v) => !v)}
          />
          <Pill
            palette={palette}
            testID="new-table-add"
            label={t(locale, 'newTableAddField')}
            onPress={() => {
              setAdding((v) => !v);
              setValueHint(false);
            }}
          />
          {rows.length > 0 ? (
            <Pill
              palette={palette}
              testID="new-table-original"
              label={t(locale, showOriginal ? 'newTableOriginalHide' : 'newTableOriginal')}
              onPress={() => setShowOriginal((v) => !v)}
            />
          ) : null}
        </View>

        {adding ? (
          <View style={{ gap: 6 }}>
            {valueHint ? (
              <Text testID="new-table-value-hint" style={muted}>
                {t(locale, 'newTableValueHint')}
              </Text>
            ) : null}
            <View style={styles.wrap}>
              <TextInput
                testID="new-table-add-name"
                autoFocus
                value={newName}
                onChangeText={setNewName}
                placeholder={t(locale, 'newTableAddFieldHint')}
                placeholderTextColor={palette.caption}
                style={[input, styles.flex]}
              />
              <Pill
                palette={palette}
                testID="new-table-add-save"
                label={t(locale, 'newTableAdd')}
                onPress={() => {
                  addField(newName);
                  setNewName('');
                  setAdding(false);
                  setValueHint(false);
                }}
              />
            </View>
          </View>
        ) : null}

        {showOriginal ? (
          <View testID="new-table-rows" style={{ gap: 6 }}>
            <Text style={muted}>{t(locale, 'newTableOriginalAbout')}</Text>
            {rows.flatMap((row, r) =>
              row.map((cell, c) => {
                const on = selected.includes(cell);
                return (
                  <Pressable
                    key={`${r}-${c}`}
                    testID={`new-table-row-${r}-${c}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() =>
                      setSelected((s) => (on ? s.filter((x) => x !== cell) : [...s, cell]))
                    }
                    style={[styles.cell, { borderColor: on ? palette.primary : palette.border }]}>
                    <Text style={text}>{cell}</Text>
                  </Pressable>
                );
              }),
            )}
            {selected.length > 0 ? (
              <Pill
                palette={palette}
                testID="new-table-row-add"
                label={t(locale, 'newTableOriginalAdd')}
                onPress={addOriginal}
              />
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: 6 }}>
          <Pill
            palette={palette}
            testID="new-table-tink"
            label={t(locale, 'newTableTink')}
            onPress={() => void askTink()}
          />
          <Text style={muted}>{t(locale, 'newTableTinkAbout')}</Text>
        </View>

        {message ? (
          <Text
            testID="new-table-error"
            style={[palette.font('body', 14), { color: palette.danger }]}>
            {message}
          </Text>
        ) : null}
        <Button
          palette={palette}
          testID="new-table-save"
          label={t(locale, 'save')}
          disabled={busy}
          onPress={() => void save()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** 「文件里还有」先显示几个字段名。 */
const FIRST_NAMES = 4;

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 140 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  row: { minHeight: 44, justifyContent: 'center' },
  remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  hidden: { display: 'none' },
  form: { gap: 16 },
  gapTop: { marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44 },
  cell: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
});
