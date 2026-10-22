import {
  FILE_LIMITS,
  renderNameTemplate,
  sanitizeFileName,
  uniqueFileName,
  type Locale,
  type Registry,
  type Workflow,
} from '@morph/core';
import { PdfError, mergePdfs } from '@morph/tool-pdf';

import type { AssetRecord, WorkspaceRepo } from '../storage/types';

// 工作流执行器（§7C）：按顺序执行已登记的动作，步骤之间通过固定数据槽传递数据。
// 这里是唯一能执行动作的地方；配置里只有动作 ID 和参数，没有任何代码。

export interface PickedFile {
  uri: string;
  name: string;
  size: number | null;
  mimeType: string | null;
}

/** 平台文件能力（App 中由 expo-file-system / document-picker / sharing 实现，测试中用假实现）。 */
export interface FilePlatform {
  /** 用户取消时返回 null。 */
  pickPdfs(): Promise<PickedFile[] | null>;
  importFile(
    file: PickedFile,
    assetId: string,
    name: string,
  ): Promise<{ path: string; size: number }>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(
    assetId: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<{ path: string; size: number }>;
  share(path: string, mimeType: string): Promise<void>;
  /** 把一段文字存成临时文件并打开系统分享面板（导出 CSV 用）。不会成为用户文件。 */
  shareText(fileName: string, text: string, mimeType: string): Promise<void>;
}

export interface RunPrompts {
  /** 用户取消时返回 null。 */
  askText(label: string, defaultValue: string): Promise<string | null>;
}

export type RunErrorCode =
  | 'tooFew'
  | 'tooMany'
  | 'notPdf'
  | 'tooLarge'
  | 'tooLargeTotal'
  | 'unreadable'
  | 'encrypted'
  | 'accessDenied'
  | 'noGrant'
  | 'saveFailed'
  | 'unsupportedAction'
  | 'unexpected';

export class RunError extends Error {
  constructor(
    readonly code: RunErrorCode,
    readonly detail: Record<string, string | number> = {},
  ) {
    super(`${code} ${JSON.stringify(detail)}`);
  }
}

class RunCancelled extends Error {}

export interface RunContext {
  workflow: Workflow;
  revisionId: number;
  repo: WorkspaceRepo;
  files: FilePlatform;
  prompts: RunPrompts;
  registry: Registry;
  locale: Locale;
  now: () => Date;
  newId: () => string;
  onStep?: (index: number) => void;
}

export type RunResult =
  | { status: 'succeeded'; savedFile: AssetRecord | null; pageCount: number | null }
  | { status: 'cancelled' }
  | { status: 'failed'; error: RunError };

interface Slots {
  files?: AssetRecord[];
  document?: {
    bytes: Uint8Array;
    mimeType: string;
    ext: string;
    sourceName: string;
    pageCount: number;
  };
  fileName?: string;
  savedFile?: AssetRecord;
}

type ActionImpl = (params: Record<string, unknown>, slots: Slots, ctx: RunContext) => Promise<void>;

const MB = 1024 * 1024;
const isPdf = (f: PickedFile) =>
  f.mimeType === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

async function saveAsset(
  ctx: RunContext,
  asset: Omit<AssetRecord, 'createdAt'>,
): Promise<AssetRecord> {
  const record = { ...asset, createdAt: ctx.now().getTime() };
  await ctx.repo.addAsset(record);
  // 工具产生或用户为它选择的文件，授权给该工具（§7G）。
  await ctx.repo.grantAsset(ctx.workflow.toolId, record.id);
  return record;
}

const ACTIONS: Record<string, ActionImpl> = {
  async 'pdf.selectFiles'(params, slots, ctx) {
    const { min, max } = params as { min: number; max: number };
    const picked = await ctx.files.pickPdfs();
    if (!picked) throw new RunCancelled();
    if (picked.length < min) throw new RunError('tooFew', { min });
    if (picked.length > max) throw new RunError('tooMany', { max });
    for (const f of picked) {
      if (!isPdf(f)) throw new RunError('notPdf', { name: f.name });
      if ((f.size ?? 0) > FILE_LIMITS.maxFileBytes) {
        throw new RunError('tooLarge', { name: f.name, mb: FILE_LIMITS.maxFileBytes / MB });
      }
    }
    if (picked.reduce((sum, f) => sum + (f.size ?? 0), 0) > FILE_LIMITS.maxTotalBytes) {
      throw new RunError('tooLargeTotal', { mb: FILE_LIMITS.maxTotalBytes / MB });
    }
    const assets: AssetRecord[] = [];
    // 重复选择同一个文件会产生新的副本；显示名追加序号，避免列表中出现同名文件（D-019）。
    const existing = (await ctx.repo.listAssets()).map((a) => a.name);
    for (const f of picked) {
      const id = ctx.newId();
      const clean = sanitizeFileName(f.name);
      const ext = /\.([^.]+)$/.exec(clean)?.[1] ?? 'pdf';
      const name = uniqueFileName(clean.replace(/\.[^.]+$/, ''), ext, existing);
      existing.push(name);
      let stored;
      try {
        stored = await ctx.files.importFile(f, id, name);
      } catch {
        throw new RunError('accessDenied', { name: f.name });
      }
      // 选择器不一定提供大小，导入后再检查一次。
      if (stored.size > FILE_LIMITS.maxFileBytes) {
        throw new RunError('tooLarge', { name: f.name, mb: FILE_LIMITS.maxFileBytes / MB });
      }
      assets.push(
        await saveAsset(ctx, {
          id,
          name,
          mimeType: 'application/pdf',
          size: stored.size,
          path: stored.path,
          source: 'picked',
        }),
      );
    }
    slots.files = assets;
  },

  async 'pdf.merge'(_params, slots, ctx) {
    const inputs = [];
    for (const asset of slots.files ?? []) {
      if (!(await ctx.repo.hasGrant(ctx.workflow.toolId, asset.id))) {
        throw new RunError('noGrant', { name: asset.name });
      }
      try {
        inputs.push({ name: asset.name, bytes: await ctx.files.readBytes(asset.path) });
      } catch {
        throw new RunError('accessDenied', { name: asset.name });
      }
    }
    try {
      const result = await mergePdfs(inputs);
      slots.document = {
        bytes: result.bytes,
        mimeType: 'application/pdf',
        ext: 'pdf',
        sourceName: baseName(inputs[0]?.name ?? ''),
        pageCount: result.pageCount,
      };
    } catch (e) {
      if (!(e instanceof PdfError)) throw e;
      if (e.code === 'tooFew') throw new RunError('tooFew', { min: 2 });
      throw new RunError(e.code, { name: e.fileName ?? '' });
    }
  },

  async 'ui.askFileName'(params, slots, ctx) {
    const { defaultTemplate } = params as { defaultTemplate: string };
    const suggested = renderNameTemplate(defaultTemplate, {
      now: ctx.now(),
      sourceName: slots.document?.sourceName ?? '',
    });
    const label = ctx.registry.actions.get('ui.askFileName')!.label[ctx.locale];
    const answer = await ctx.prompts.askText(label, suggested);
    if (answer === null) throw new RunCancelled();
    slots.fileName = sanitizeFileName(answer);
  },

  async 'file.save'(params, slots, ctx) {
    const { nameTemplate } = params as { nameTemplate: string };
    const doc = slots.document!;
    const base =
      slots.fileName ??
      renderNameTemplate(nameTemplate, { now: ctx.now(), sourceName: doc.sourceName });
    const existing = (await ctx.repo.listAssets()).map((a) => a.name);
    const name = uniqueFileName(base, doc.ext, existing);
    const id = ctx.newId();
    let stored;
    try {
      stored = await ctx.files.writeBytes(id, name, doc.bytes);
    } catch (e) {
      throw new RunError('saveFailed', { detail: String(e) });
    }
    slots.savedFile = await saveAsset(ctx, {
      id,
      name,
      mimeType: doc.mimeType,
      size: stored.size,
      path: stored.path,
      source: 'generated',
    });
  },
};

export async function runWorkflow(ctx: RunContext): Promise<RunResult> {
  const runId = await ctx.repo.startToolRun({
    toolId: ctx.workflow.toolId,
    workflowId: ctx.workflow.id,
    revisionId: ctx.revisionId,
  });
  const slots: Slots = {};
  try {
    for (const [index, step] of ctx.workflow.steps.entries()) {
      ctx.onStep?.(index);
      const impl = ACTIONS[step.action];
      const def = ctx.registry.actions.get(step.action);
      if (!impl || !def) throw new RunError('unsupportedAction', { action: step.action });
      // 配置已在保存前校验过；执行前再按动作契约解析一次参数。
      await impl(def.params.parse(step.params), slots, ctx);
    }
    await ctx.repo.finishToolRun(runId, {
      status: 'succeeded',
      ...(slots.savedFile ? { outputAssetId: slots.savedFile.id } : {}),
    });
    return {
      status: 'succeeded',
      savedFile: slots.savedFile ?? null,
      pageCount: slots.document?.pageCount ?? null,
    };
  } catch (e) {
    if (e instanceof RunCancelled) {
      await ctx.repo.finishToolRun(runId, { status: 'cancelled' });
      return { status: 'cancelled' };
    }
    const error = e instanceof RunError ? e : new RunError('unexpected', { detail: String(e) });
    // 执行记录只保存错误代码，不保存文件内容（§6 ToolRun）。
    await ctx.repo.finishToolRun(runId, { status: 'failed', error: error.code });
    return { status: 'failed', error };
  }
}

export function newAssetId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
