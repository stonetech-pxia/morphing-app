import {
  MAX_SET_ALL,
  createInput,
  loadComputedRecords,
  prepareRecordValues,
  rowUpdateInput,
  setAllChanges,
  expandCollection,
  isOpenUse,
  recordToolOf,
  type DataRecord,
  type OpenUse,
  type RecordTool,
  type RecordToolUse,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { t } from '../i18n';
import { openRow } from '../renderer/open-row';
import { useCalendar, useWorkspace, useWorkspaceContext } from '../workspace/context';
import { useRecordActions } from './records';

// 一键记录操作（D-300–D-304）：用户点了按钮或列表里的行按钮才执行，直接写数据库（和表单一样不经过 AI、
// 不生成版本），每次都弹可以撤销的提示条（打开表单的，新建到另一张表时存好后弹，底线 11）。操作由 AI 配置，值在这里按当时的时间和记录算出来。

// 一次只执行一个：连点几下 +1 时一个接一个算，不会两次都从同一个旧值加。桌面小组件的点按也排在这里（D-323）。
let queue: Promise<unknown> = Promise.resolve();
export function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

export function useRecordActionRunner() {
  const { repo, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config);
  const bump = useWorkspace((s) => s.bumpRecords);
  const showToast = useWorkspace((s) => s.showToast);
  const actions = useRecordActions();
  const cal = useCalendar();
  const router = useRouter();

  const openNew = (collectionId: string, prefill?: Record<string, unknown>, undo = false) =>
    router.push({
      pathname: '/record/[collectionId]',
      params: {
        collectionId,
        ...(prefill ? { prefill: JSON.stringify(prefill) } : {}),
        ...(undo ? { undo: '1' } : {}),
      },
    });
  const openRecord = (collectionId: string, recordId: string) =>
    router.push({ pathname: '/record/[collectionId]', params: { collectionId, recordId } });

  async function create(
    tool: Extract<RecordTool, { do: 'create' }>,
    ctx: { rowId?: string | undefined; recordId?: string | undefined },
    /** 点的那一行所在的表；块本身的按钮没有。 */
    fromTable?: string,
  ) {
    const collection = config?.data.tables.find((c) => c.id === tool.table);
    if (!collection) return;
    const input = createInput(collection, tool.values, { now: new Date(), cal, ...ctx });
    // D-338：打开新记录的表单，预设的值先填好，用户补完再保存（表单自己保存，不弹提示条）。
    // Q6：按钮模式的「添加」（原 recordForm button）也预填预设值。
    // 底线 11：新建到另一张表（按钮、别的表的行上）不容易改回去，表单存好后显示撤销。
    if (tool.ask !== undefined) return void openNew(collection.id, input, fromTable !== tool.table);
    const result = await actions.add(collection, input);
    if (result.ok) {
      showToast({
        message: t(locale, 'recordActionAdded', { table: collection.name }),
        undo: { kind: 'discard', id: result.id },
      });
    } else if ('full' in result) {
      Alert.alert(t(locale, 'tableFull'));
    } else {
      // 存不进去（旧配置里必填字段没有值）：打开表单让用户补上。
      openNew(collection.id);
    }
  }

  async function setAll(tool: Extract<RecordTool, { do: 'setAll' }>, label: string) {
    const collection = config?.data.tables.find((c) => c.id === tool.table);
    if (!config || !collection) return;
    const now = new Date();
    const { records } = await loadComputedRecords(
      (id) => repo.listRecords(id),
      config.data.tables,
      collection,
      now,
      cal,
    );
    const view = expandCollection(config.data.tables, collection);
    const changes = setAllChanges(tool, collection, view, records, { now, cal });
    if (changes.length === 0) {
      showToast({ message: t(locale, 'recordActionNothing') });
      return;
    }
    if (changes.length > MAX_SET_ALL) {
      Alert.alert(label, t(locale, 'recordActionTooMany', { max: MAX_SET_ALL, n: changes.length }));
      return;
    }
    const confirmed = await new Promise<boolean>((resolve) =>
      Alert.alert(
        label,
        t(locale, 'recordActionConfirm', { n: changes.length }),
        [
          { text: t(locale, 'cancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: t(locale, 'recordActionConfirmButton'), onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      ),
    );
    if (!confirmed) return;
    const at = Date.now();
    for (const c of changes) await repo.updateRecord(c.id, c.after, at);
    bump();
    showToast({
      message: t(locale, 'recordActionChanged', { n: changes.length }),
      undo: { kind: 'revert', records: changes.map((c) => ({ id: c.id, values: c.before })) },
    });
  }

  return {
    /** 块本身的工具（button 的 tools[0]）：不作用在某一条上。 */
    runButton(use: RecordToolUse, label: string): Promise<void> {
      return serial(async () => {
        const tool = recordToolOf(use);
        if (tool.do === 'setAll') return setAll(tool, label);
        if (tool.do === 'create') await create(tool, {});
      });
    },

    /**
     * 一条记录上的工具（button、tap、check、drag）。record 是列表上显示的那条（可能已经不在了，按 ID 重新读）；
     * 写哪张表看工具自己的 table（关系规则 12）。group 是拖到的那一栏（"$group"）。
     * message 换掉提示条上的「{label}：已记下」（看板移动卡片用，D-314）。
     */
    runRow(
      use: RecordToolUse | OpenUse,
      record: DataRecord,
      options: { message?: string; group?: string | null } = {},
    ): Promise<void> {
      return serial(async () => {
        if (isOpenUse(use)) return void openRow(router, use.opens, record.collectionId, record.id);
        const tool = recordToolOf(use);
        if (tool.do === 'create') return create(tool, { rowId: record.id }, record.collectionId);
        if (tool.do === 'setAll') return setAll(tool, use.label ?? '');
        const collection = config?.data.tables.find((c) => c.id === tool.table);
        if (!collection) return;
        const stored = await repo.getRecord(record.id);
        if (!stored || stored.deletedAt !== null) {
          showToast({ message: t(locale, 'recordActionGone') });
          bump();
          return;
        }
        const now = new Date();
        const input = rowUpdateInput(tool, collection, stored.values, {
          now,
          cal,
          rowId: record.id,
          group: options.group,
        });
        if (!input) return;
        const prepared = prepareRecordValues(collection, input, stored.values, now, cal);
        if (!prepared.ok) return void openRecord(collection.id, record.id);
        await repo.updateRecord(record.id, prepared.values, now.getTime());
        bump();
        showToast({
          message: options.message ?? t(locale, 'recordActionDone', { label: use.label ?? '' }),
          undo: { kind: 'revert', records: [{ id: record.id, values: stored.values }] },
        });
      });
    },
  };
}
