import {
  MAX_TRANSLATE_CHARS,
  RunCancelled,
  RunError,
  groupBySource,
  joinTranslation,
  splitForTranslation,
  translateLanguageName,
  type ActionImpl,
} from '@morph/core';

import { t } from '../../i18n';
import type { RunServices } from './helpers';

// 翻译（D-170）：系统自带的本机翻译（iOS 的 Translation 框架，Android 的 ML Kit）。
// 先把文字拆成段（core 的 splitForTranslation），按原文语言分组翻译，再按原来的分段拼回去。
// 文字只在本机处理，不上传、不发给 AI（D-036）。

type Impl = ActionImpl<RunServices>;

/** 一次交给系统翻译多少段：太多时进度很久不动，太少时调用次数多。 */
const BATCH = 20;
const MB = 1024 * 1024;

const codeOf = (e: unknown) => (e as { code?: string }).code;

export const TRANSLATE_IMPLS: Record<string, Impl> = {
  async 'translate.text'(input, params, ctx) {
    if (input?.type !== 'text') throw new RunError('emptyText');
    const text = input.text.trim();
    if (!text) throw new RunError('emptyText');
    if (text.length > MAX_TRANSLATE_CHARS) {
      throw new RunError('textTooLong', { max: MAX_TRANSLATE_CHARS });
    }
    const { locale } = ctx;
    const translator = ctx.services.files.translator;
    if (!translator) {
      throw new RunError('unsupportedAction', { action: t(locale, 'translateNeedsFullApp') });
    }
    if (!translator.supported) {
      throw new RunError('unsupportedAction', { action: t(locale, 'translateOsTooOld') });
    }
    const from = String(params.from);
    const to = String(params.to);
    const name = (code: string) => translateLanguageName(code, locale);
    const names = (codes: readonly string[]) =>
      [...new Set(codes)].map(name).join(locale === 'zh' ? '、' : ', ');

    const pieces = splitForTranslation(text);
    const flat = pieces.flat(2);
    const detected = from === 'auto' ? await translator.detectLanguages(flat) : null;
    const groups = groupBySource(flat, detected, from, to);
    // 已经是目标语言（中文材料翻成中文）：原样交给下一步。
    if (groups.size === 0) return input;

    // 先确认每一对语言都能翻；Android 要下载的语言一次问完（D-064、D-112：只说要下多少、之后能离线用）。
    const missing = new Set<string>();
    for (const source of groups.keys()) {
      const status = await translator.status(source, to);
      if (status.status === 'unsupported') {
        throw new RunError('unsupportedAction', {
          action: t(locale, 'translatePairUnsupported', { from: name(source), to: name(to) }),
        });
      }
      if (status.status === 'download') for (const l of status.missing ?? []) missing.add(l);
    }
    if (missing.size > 0 && translator.download) {
      const langs = names([...missing]);
      const mb = Math.round((missing.size * (translator.downloadBytes ?? 0)) / MB);
      const ok = await ctx.services.ui.confirm(
        t(locale, 'translateDownloadAsk', { mb }),
        t(locale, 'translateDownload'),
        t(locale, 'cancel'),
        t(locale, 'translateDownloadBody', { langs }),
      );
      if (!ok) throw new RunCancelled();
      for (const language of missing) {
        ctx.throwIfCancelled();
        try {
          await translator.download(language);
        } catch {
          throw new RunError('packFailed', {
            detail: t(locale, 'translateDownloadFailed', { langs }),
          });
        }
      }
    }

    const out = [...flat];
    const total = [...groups.values()].reduce((n, list) => n + list.length, 0);
    let done = 0;
    for (const [source, indexes] of groups) {
      for (let i = 0; i < indexes.length; i += BATCH) {
        ctx.throwIfCancelled();
        const batch = indexes.slice(i, i + BATCH);
        let result: string[];
        try {
          result = await translator.translate(
            batch.map((k) => flat[k]!),
            source,
            to,
          );
        } catch (e) {
          // iOS：用户在系统的下载弹窗里点了取消。
          if (codeOf(e) === 'cancelled') throw new RunCancelled();
          if (codeOf(e) === 'unsupported') {
            throw new RunError('unsupportedAction', {
              action: t(locale, 'translatePairUnsupported', { from: name(source), to: name(to) }),
            });
          }
          if (codeOf(e) === 'download') {
            throw new RunError('packFailed', {
              detail: t(locale, 'translateDownloadFailed', { langs: names([source, to]) }),
            });
          }
          throw new RunError('unexpected', { detail: String((e as Error).message ?? e) });
        }
        batch.forEach((k, j) => (out[k] = result[j] ?? flat[k]!));
        done += batch.length;
        ctx.progress(done, total);
      }
    }

    let k = 0;
    const translated = pieces.map((lines) => lines.map((parts) => parts.map(() => out[k++]!)));
    // 译文只留在本机：结果页可以复制，后面的步骤可以存成文件或排成 PDF，绝不发给 AI。
    return { type: 'text', text: joinTranslation(translated, to), name: input.name };
  },
};
