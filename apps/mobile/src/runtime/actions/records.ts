import {
  RECORD_LIMITS,
  RunCancelled,
  RunError,
  attachmentIds,
  isFileValue,
  prepareRecordValues,
  type ActionImpl,
  type Collection,
  type RunItem,
} from '@morph/core';

import { newAssetId } from '../runner';
import { saveItems } from './io';
import type { RunServices } from './helpers';

// 记一笔（D-187）：每个文件（或这段文字）在一张数据表里加一条记录。表单由用户在运行时填，
// 文件先存成 Morph 的文件再放进附件字段。记录直接写数据库，不进配置、不生成版本，也不发给 AI（D-036）。

type Impl = ActionImpl<RunServices>;

/** 表单校验时附件字段的占位值（真正的文件 ID 在用户填完、文件存好之后才有）。 */
export const PENDING_FILE = 'pending-file';

/** 文件放进哪个字段、文字放进哪个字段：第一个附件字段；第一个长文本，没有就第一个文字字段。 */
export function recordTargets(collection: Collection) {
  return {
    fileField: collection.fields.find((f) => f.type === 'file')?.id,
    textField: (
      collection.fields.find((f) => f.type === 'note') ??
      collection.fields.find((f) => f.type === 'text')
    )?.id,
  };
}

export const RECORD_IMPLS: Record<string, Impl> = {
  async 'out.addRecord'(input, params, ctx) {
    const { collectionId } = params as { collectionId: string };
    const { repo, ui, collections } = ctx.services;
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) throw new RunError('unexpected', { detail: `no data table ${collectionId}` });
    const { fileField, textField } = recordTargets(collection);
    const entries: { file?: RunItem; text?: string }[] = isFileValue(input)
      ? input.items.map((file) => ({ file }))
      : [{ text: input?.type === 'text' ? input.text : '' }];
    const files: RunItem[] = [];
    for (const [i, entry] of entries.entries()) {
      ctx.throwIfCancelled();
      const counts = await repo.countRecords();
      if (
        (counts.find((c) => c.collectionId === collection.id)?.count ?? 0) >=
        RECORD_LIMITS.perCollection
      ) {
        throw new RunError('tooMany', { max: RECORD_LIMITS.perCollection });
      }
      const prefill: Record<string, unknown> = {};
      if (entry.text !== undefined && textField) prefill[textField] = entry.text;
      if (entry.file && fileField) prefill[fileField] = PENDING_FILE;
      const answer = await ui.open('recordEntry', {
        collection,
        prefill,
        ...(entry.file ? { file: entry.file } : {}),
        index: i,
        total: entries.length,
      });
      if (!answer) throw new RunCancelled();
      let file = entry.file;
      if ('skip' in answer) {
        if (file) files.push(file);
        continue;
      }
      const values = { ...prefill, ...answer.values };
      if (file && fileField) {
        [file] = await saveItems(ctx.services, [file], ctx);
        // 这一步的文件放在最前面，后面是用户在表单里另外添加的（D-263，已经是用户文件）。
        const extra = attachmentIds(values[fileField]).filter((id) => id !== PENDING_FILE);
        values[fileField] = [file!.assetId!, ...extra];
        ctx.saved.push(file!.assetId!);
      }
      const now = ctx.now();
      const prepared = prepareRecordValues(collection, values, null, now, ctx.services.calendar);
      // 表单已经按同样的规则校验过；这里出错说明表结构在运行中变了。
      if (!prepared.ok) throw new RunError('badField', { name: prepared.issues[0]!.fieldId });
      await repo.insertRecord({
        id: newAssetId(),
        collectionId: collection.id,
        values: prepared.values,
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
      });
      if (file) files.push(file);
      ctx.progress(i + 1, entries.length);
    }
    return isFileValue(input) ? { ...input, items: files } : input!;
  },
};
