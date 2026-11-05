import {
  MAX_ATTACHMENTS,
  RECORD_LIMITS,
  RunCancelled,
  RunError,
  appendPrefill,
  attachRoom,
  attachmentIds,
  isFileValue,
  prepareRecordValues,
  recordTargets,
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

// 文件放进哪个字段、文字放进哪个字段：core 的 recordTargets（放进已有记录时用同一份规则）。
export { recordTargets };

export const RECORD_IMPLS: Record<string, Impl> = {
  async 'out.addRecord'(input, params, ctx) {
    const { collectionId, each, into } = params as {
      collectionId: string;
      each?: boolean;
      into?: 'new' | 'existing';
    };
    const { repo, ui, files, collections } = ctx.services;
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) throw new RunError('unexpected', { detail: `no data table ${collectionId}` });
    if (into === 'existing') return addToExisting(input, collection, ctx);
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

/**
 * 放进已有的记录（D-443）：用户在运行时选这张表里的一条记录，文件接在它的附件后面、文字接在它的文字后面，
 * 表单里核对并保存才写进去。只追加：原来的文件和文字一个都不替换、不删除（用户自己在表单里改是用户的事）。
 * 这一步新存的文件是这张表单的副本：没写进记录的（取消、记录已经没了、写入失败）都删掉，之前步骤存好的不归它。
 */
async function addToExisting(
  input: Parameters<Impl>[0],
  collection: Collection,
  ctx: Parameters<Impl>[2],
) {
  const { repo, ui, files, calendar } = ctx.services;
  const { fileField, textField } = recordTargets(collection);
  const items = isFileValue(input) ? input.items : null;
  const text = input?.type === 'text' ? input.text : null;
  // 放不进去的（表里没有对应的字段）配置检查就不让存；这里是表在运行中变了。
  if ((items !== null && fileField === undefined) || (text !== null && textField === undefined))
    throw new RunError('unexpected', { detail: `no place in ${collection.id}` });
  ctx.throwIfCancelled();
  const all = await repo.listRecords(collection.id);
  if (all.length === 0) throw new RunError('notFound', { name: collection.name });
  const picked = await ui.open('recordPick', { collection, records: all });
  if (!picked) throw new RunCancelled();
  ctx.throwIfCancelled();
  const record = await repo.getRecord(picked.recordId);
  if (!record || record.deletedAt !== null)
    throw new RunError('notFound', { name: collection.name });

  // 附件放得下几个：满了就不运行，不要先把文件存下来又删掉。
  let toAdd: RunItem[] = [];
  if (items !== null) {
    const room = attachRoom(collection, record.values);
    if (room === 0) throw new RunError('recordFull', { max: MAX_ATTACHMENTS });
    toAdd = items.slice(0, room);
  }
  const saved = items !== null ? await saveItems(ctx.services, toAdd, ctx) : [];
  const unused = new Set(saved.filter((_, n) => !toAdd[n]!.assetId).map((file) => file.assetId!));
  try {
    const prefill = appendPrefill(collection, record.values, {
      ...(items !== null ? { fileIds: saved.map((f) => f.assetId!) } : {}),
      ...(text !== null ? { text } : {}),
    });
    const answer = await ui.open('recordEntry', {
      collection,
      prefill,
      existing: record,
      ...(items !== null && items.length > toAdd.length ? { overflow: true } : {}),
      index: 0,
      total: 1,
    });
    if (!answer || 'skip' in answer) throw new RunCancelled();
    // 表单开着的时候这条记录可能被删了：什么都不写。
    const fresh = await repo.getRecord(record.id);
    if (!fresh || fresh.deletedAt !== null)
      throw new RunError('notFound', { name: collection.name });
    const now = ctx.now();
    const prepared = prepareRecordValues(
      collection,
      { ...answer.values },
      fresh.values,
      now,
      calendar,
    );
    if (!prepared.ok) throw new RunError('badField', { name: prepared.issues[0]!.fieldId });
    await repo.updateRecord(record.id, prepared.values, now.getTime());
    const used = fileField ? attachmentIds(prepared.values[fileField]) : [];
    for (const file of saved) {
      if (!file.assetId || !used.includes(file.assetId)) continue;
      unused.delete(file.assetId);
      ctx.saved.push(file.assetId);
    }
  } finally {
    await deleteUserFiles([...unused], repo, files);
  }
  // 文件原样交给下一步（用保存好的那一份，和新建一样）。
  if (items === null) return input!;
  const stored = new Map(toAdd.map((item, n) => [item, saved[n]!] as const));
  return { ...(input as object), items: items.map((item) => stored.get(item) ?? item) } as never;
}
