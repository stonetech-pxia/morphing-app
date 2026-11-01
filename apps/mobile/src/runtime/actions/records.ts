import {
  MAX_ATTACHMENTS,
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

import { deleteUserFiles } from '../../storage/user-files';
import { newAssetId } from '../runner';
import { saveItems } from './io';
import type { RunServices } from './helpers';

// 记一笔（D-187、D-397）：这次的文件（或这段文字）在一张数据表里加一条记录。表单由用户在运行时填，
// 文件先存成 Morph 的文件再放进附件字段。记录直接写数据库，不进配置、不生成版本，也不发给 AI（D-036）。

type Impl = ActionImpl<RunServices>;

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
    const { collectionId, each } = params as { collectionId: string; each?: boolean };
    const { repo, ui, files, collections } = ctx.services;
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) throw new RunError('unexpected', { detail: `no data table ${collectionId}` });
    const { fileField, textField } = recordTargets(collection);
    const items = isFileValue(input) ? input.items : null;
    // 默认这次的文件都进同一条记录（一份两页的合同是一条，D-397）；每个文件一条要写 each。
    // 表里没有附件字段时文件放不进去，每个文件一张表单，让用户看着它填。
    const together = items !== null && fileField !== undefined && each !== true;
    const entries: RunItem[][] =
      items === null
        ? [[]]
        : together
          ? [items.slice(0, MAX_ATTACHMENTS)]
          : items.map((item) => [item]);
    const stored = new Map<RunItem, RunItem>();
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
      if (items === null && input?.type === 'text' && textField) prefill[textField] = input.text;
      // 打开表单前就存成用户文件，表单才能读它们（D-394）。这一步新存的是这张表单的副本：
      // 没进记录的（跳过、关掉、从表单里去掉、写入失败）都删掉；之前的步骤存好的不归它。
      const saved = fileField ? await saveItems(ctx.services, entry, ctx) : entry;
      const unused = new Set(
        saved.filter((_, n) => !entry[n]!.assetId).map((file) => file.assetId!),
      );
      try {
        if (fileField && saved.length > 0) prefill[fileField] = saved.map((f) => f.assetId!);
        const answer = await ui.open('recordEntry', {
          collection,
          prefill,
          ...(!fileField && entry[0] ? { file: entry[0] } : {}),
          ...(together && items.length > MAX_ATTACHMENTS ? { overflow: true } : {}),
          index: i,
          total: entries.length,
        });
        if (!answer) throw new RunCancelled();
        if ('skip' in answer) continue;
        const values = { ...prefill, ...answer.values };
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
        const used = fileField ? attachmentIds(values[fileField]) : [];
        for (const [n, file] of saved.entries()) {
          if (!file.assetId || !used.includes(file.assetId)) continue;
          unused.delete(file.assetId);
          stored.set(entry[n]!, file);
          ctx.saved.push(file.assetId);
        }
      } finally {
        await deleteUserFiles([...unused], repo, files);
      }
      ctx.progress(i + 1, entries.length);
    }
    return items !== null
      ? ({ ...(input as object), items: items.map((item) => stored.get(item) ?? item) } as never)
      : input!;
  },
};
