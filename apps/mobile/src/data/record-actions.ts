import {
  MAX_SET_ALL,
  createInput,
  loadComputedRecords,
  prepareRecordValues,
  rowUpdateInput,
  setAllChanges,
  expandCollection,
  type ButtonAction,
  type Collection,
  type DataRecord,
  type RecordActionValue,
  type RowAction,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { t } from '../i18n';
import { useCalendar, useWorkspace, useWorkspaceContext } from '../workspace/context';
import { useRecordActions } from './records';

// 一键记录操作（D-300–D-304）：用户点了按钮或列表里的行按钮才执行，直接写数据库（和表单一样不经过 AI、
// 不生成版本），每次都弹可以撤销的提示条。操作由 AI 配置，值在这里按当时的时间和记录算出来。

// 一次只执行一个：连点几下 +1 时一个接一个算，不会两次都从同一个旧值加。
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
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

  const openNew = (collectionId: string) =>
    router.push({ pathname: '/record/[collectionId]', params: { collectionId } });
  const openRecord = (collectionId: string, recordId: string) =>
    router.push({ pathname: '/record/[collectionId]', params: { collectionId, recordId } });

  async function create(
    collection: Collection,
    values: Record<string, RecordActionValue> | undefined,
    rowId?: string,
  ) {
    const result = await actions.add(
      collection,
      createInput(collection, values, { now: new Date(), cal, rowId }),
    );
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

  async function setAll(action: Extract<ButtonAction, { do: 'setAll' }>, label: string) {
    const collection = config?.collections.find((c) => c.id === action.collectionId);
    if (!config || !collection) return;
    const now = new Date();
    const { records } = await loadComputedRecords(
      (id) => repo.listRecords(id),
      config.collections,
      collection,
      now,
      cal,
    );
    const view = expandCollection(config.collections, collection);
    const changes = setAllChanges(action, collection, view, records, { now, cal });
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
    /** 按钮上的操作。 */
    runButton(action: ButtonAction, label: string): Promise<void> {
      return serial(async () => {
        if (action.do === 'open') return void openNew(action.collectionId);
        if (action.do === 'setAll') return setAll(action, label);
        const collection = config?.collections.find((c) => c.id === action.collectionId);
        if (collection) await create(collection, action.values);
      });
    },

    /** 列表里某一行的按钮。record 是列表上显示的那条（可能已经不在了，按 ID 重新读）。 */
    runRow(action: RowAction, record: DataRecord, collection: Collection): Promise<void> {
      return serial(async () => {
        if (action.do === 'open') return void openRecord(collection.id, record.id);
        if (action.do === 'create') {
          const target = config?.collections.find((c) => c.id === action.collectionId);
          if (target) await create(target, action.values, record.id);
          return;
        }
        const stored = await repo.getRecord(record.id);
        if (!stored || stored.deletedAt !== null) {
          showToast({ message: t(locale, 'recordActionGone') });
          bump();
          return;
        }
        const now = new Date();
        const input = rowUpdateInput(action, collection, stored.values, { now, cal });
        if (!input) return;
        const prepared = prepareRecordValues(collection, input, stored.values, now, cal);
        if (!prepared.ok) return void openRecord(collection.id, record.id);
        await repo.updateRecord(record.id, prepared.values, now.getTime());
        bump();
        showToast({
          message: t(locale, 'recordActionDone', { label: action.label }),
          undo: { kind: 'revert', records: [{ id: record.id, values: stored.values }] },
        });
      });
    },
  };
}
