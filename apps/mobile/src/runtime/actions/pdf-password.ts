import { RunCancelled, RunError, type ActionImpl, type RunItem } from '@morph/core';

import { displayName, fileItems, freshName, type RunServices } from './helpers';

// PDF 密码（D-194）：去掉打开密码、加上打开密码。iOS 用 PDFKit（modules/morph-docs）；
// Android 和 Expo Go 没有（P-025），运行时报不支持。密码只在这一次运行里用，不保存、不进运行记录。

type Impl = ActionImpl<RunServices>;

function passwordsOf(ctx: Parameters<Impl>[2]) {
  const passwords = ctx.services.files.documents.passwords;
  if (!passwords) throw new RunError('pdfPasswordUnsupported');
  return passwords;
}

async function lockStateOf(ctx: Parameters<Impl>[2], item: RunItem) {
  try {
    return await passwordsOf(ctx).lockState(item.uri);
  } catch (e) {
    if (e instanceof RunError) throw e;
    throw new RunError('unreadable', { name: displayName(item) });
  }
}

export const PDF_PASSWORD_IMPLS: Record<string, Impl> = {
  async 'pdf.unlock'(input, _params, ctx) {
    const passwords = passwordsOf(ctx);
    const items = fileItems(input);
    const out: RunItem[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      // 图片等别的文件原样交给下一步（例如和对账单一起合并的照片）。
      const state = item.mimeType === 'application/pdf' ? await lockStateOf(ctx, item) : 'none';
      if (state === 'none') {
        out.push(item);
        continue;
      }
      // 不用密码就能打开、只限制了打印和复制的，不解除（P-027）。
      if (state === 'restricted') throw new RunError('pdfRestricted', { name: displayName(item) });
      let wrong = false;
      for (;;) {
        const answer = await ctx.services.ui.open('password', {
          name: displayName(item),
          wrong,
          index: i,
          total: items.length,
        });
        if (!answer) throw new RunCancelled();
        if ('skip' in answer) break;
        const unlocked = await passwords.unlock(
          item.uri,
          answer.password,
          ctx.services.runId,
          freshName(item.name, 'pdf'),
        );
        if (unlocked) {
          out.push({ ...item, uri: unlocked.uri, size: unlocked.size });
          break;
        }
        wrong = true;
      }
    }
    if (out.length === 0) throw new RunError('tooFew', { min: 1, kind: 'PDF' });
    return { ...input!, items: out } as typeof input & { items: RunItem[] };
  },

  async 'pdf.protect'(input, _params, ctx) {
    const passwords = passwordsOf(ctx);
    const password = ctx.secrets.password;
    if (!password) throw new RunError('passwordMissing');
    const items = fileItems(input);
    const out: RunItem[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      ctx.progress(i, items.length);
      if ((await lockStateOf(ctx, item)) !== 'none') {
        throw new RunError('encrypted', { name: displayName(item) });
      }
      const done = await passwords.protect(
        item.uri,
        password,
        ctx.services.runId,
        freshName(item.name, 'pdf'),
      );
      out.push({ ...item, uri: done.uri, size: done.size });
    }
    ctx.progress(items.length, items.length);
    return { type: 'pdf', items: out };
  },
};
