import { CORE_ACTIONS } from '../registry';
import {
  quickActionsOf,
  type Locale,
  type Workflow,
  type WorkflowStep,
  type WorkspaceConfig,
} from '../schema';
import { BUILTIN_TOOLS } from '../tools';
import type { ActionDefinition } from '../workflow/contract';
import { WORKFLOW_PRESETS, type WorkflowPreset } from '../workflows/presets';

export { LANGUAGE_WORD, languageOf } from '../workflow/phrase-words';

// mock AI 的工作流句式（docs/MOCK_AI_PHRASES.md W1–W7）：把「选照片、压到 500KB、分享」这类短语
// 翻译成步骤。只认识固定的说法；认不出的短语返回 null，由调用方整句拒绝。
// 每个动作认的说法写在动作定义的 phrases 里（tools/*.ts）；这里只按前一步换成接得上的动作、拼成步骤。

/** 一个步骤短语 → 动作和参数。 */
export interface StepPhrase {
  action: string;
  params: Record<string, unknown>;
  /** 每次运行时问的参数（「输入文字」要问文字）。 */
  ask?: string[] | undefined;
  /** 记一笔（D-187）：句子里说的表名，由调用方按当前配置换成 collectionId；空字符串表示没说。 */
  table?: string;
}

/** 把命名短语里的「日期」换成模板。 */
export function nameTemplateOf(words: string): string {
  return words
    .replace(/日期|\bdate\b/gi, '{date:YYYY-MM-DD}')
    .replace(/原文件名|source name/gi, '{sourceName}');
}

/**
 * 认步骤说法的动作：内置的全部动作，说法写在各自定义的 phrases 里（D-265）。
 * 不同动作的说法互不重叠，所以先查哪个动作都一样。下载的工具不能加动作，不用看注册表。
 */
const PHRASE_ACTIONS: readonly ActionDefinition[] = [
  ...CORE_ACTIONS,
  ...BUILTIN_TOOLS.flatMap((tool) => tool.actions),
].filter((a) => a.phrases?.length);

export function parseStepPhrase(text: string, locale: Locale): StepPhrase | null {
  const clean = text.replace(/^(?:再|然后|最后|先|接着|and then|then|and)\s*/i, '').trim();
  for (const action of PHRASE_ACTIONS) {
    for (const phrase of action.phrases!) {
      const m = clean.match(phrase.match);
      if (!m) continue;
      const step: StepPhrase = {
        action: action.id,
        ...(phrase.step?.(m, locale) ?? { params: {} }),
      };
      if (step.action === 'file.rename') {
        step.params = { template: nameTemplateOf(String(step.params.template)) };
      }
      return step;
    }
  }
  return null;
}

/** 「选照片、压到 500KB、分享」/「choose photos, compress to 500 KB, then share」→ 步骤短语。 */
export function splitStepPhrases(text: string): string[] {
  return text
    .split(/、|→|->|,|，|然后|\bthen\b|\band\b(?! (?:images|photos))/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 新步骤的 ID：动作名的后半段，重复时加序号。 */
export function stepIdFor(action: string, taken: readonly { id: string }[]): string {
  const base = action
    .split('.')[1]!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const used = new Set(taken.map((s) => s.id));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** 输出文字的动作：后面的「转成 PDF」是文字转 PDF（D-174）。 */
const TEXT_OUTPUT = new Set([
  'in.text',
  'audio.transcribe',
  'ocr.recognize',
  'pdf.extractText',
  'translate.text',
  'qr.read',
  'text.copy',
]);

/**
 * 同一句话按前一步换成接得上的动作：选 PDF 之后的「提取文字」是提取 PDF 文字；
 * 文字之后的「转成 PDF」是文字转 PDF。
 */
function fitToPrevious(p: StepPhrase, previous: WorkflowStep | undefined): StepPhrase {
  if (
    p.action === 'ocr.recognize' &&
    previous?.action === 'in.files' &&
    previous.params.accept === 'pdf'
  ) {
    return { action: 'pdf.extractText', params: {} };
  }
  if (p.action === 'pdf.fromImages' && previous && TEXT_OUTPUT.has(previous.action)) {
    return { action: 'text.toPdf', params: { pageSize: 'a4', fontSize: 12 } };
  }
  // 格式转换（D-183–D-186）：Word 之后的「转成 PDF」是文档转 PDF；视频之后的「转成 GIF」是视频转 GIF，
  // 「转成 MP3」是提取视频里的声音。
  if (
    p.action === 'pdf.fromImages' &&
    previous?.action === 'in.files' &&
    previous.params.accept === 'documents'
  ) {
    return { action: 'pdf.fromDocument', params: { pageSize: 'a4' } };
  }
  if (previous && makesVideo(previous)) {
    if (p.action === 'image.toGif')
      return { action: 'video.toGif', params: { width: 480, fps: 12 } };
    if (p.action === 'audio.convert') return { action: 'audio.fromVideo', params: p.params };
  }
  return p;
}

/** 这一步的结果是视频。 */
const makesVideo = (step: WorkflowStep) =>
  step.action === 'in.videos' ||
  (step.action !== 'video.subtitles' &&
    step.action.startsWith('video.') &&
    !['video.toGif', 'video.frame'].includes(step.action)) ||
  (step.action === 'in.files' && step.params.accept === 'videos');

/** 这一步之后的值大致是什么（只用来给「压到 N MB」选动作）。 */
export type PhraseKind = 'images' | 'video' | 'audio' | 'pdf' | 'other';

function kindAfter(step: StepPhrase, before: PhraseKind | null): PhraseKind | null {
  if (step.action === 'in.photos' || step.action.startsWith('image.')) return 'images';
  if (step.action === 'audio.volume' || step.action === 'audio.denoise') return before;
  if (step.action === 'audio.transcribe') return 'other';
  if (step.action === 'in.audio' || step.action.startsWith('audio.')) return 'audio';
  if (step.action === 'video.subtitles') return 'other';
  if (step.action === 'video.frame') return 'images';
  if (step.action === 'video.toGif') return 'images';
  if (step.action === 'in.videos' || step.action.startsWith('video.')) return 'video';
  if (step.action === 'in.files') {
    const accept = step.params.accept;
    return accept === 'pdf'
      ? 'pdf'
      : accept === 'videos'
        ? 'video'
        : accept === 'audio'
          ? 'audio'
          : 'other';
  }
  if (step.action === 'pdf.toImages') return 'images';
  if (step.action.startsWith('pdf.')) return 'pdf';
  if (step.action === 'zip.create') return 'other';
  return before;
}

/**
 * 「压到 N MB」默认是压图片；前面是视频时换成压缩视频，是 PDF 时换成压缩 PDF（D-147）。
 * before：这些步骤之前的值（往已有快捷操作里加步骤时）。
 */
export function fitSizePhrases(
  phrases: readonly StepPhrase[],
  before: PhraseKind | null = null,
): StepPhrase[] {
  let kind = before;
  return phrases.map((p) => {
    let step = p;
    // 音频（D-157）：「压到 N MB」是压音频，「剪一段」是剪音频，「合并」是合成一段。
    if (kind === 'audio') {
      if (p.action === 'image.compress') {
        const mb = Number(p.params.maxKB) / 1024;
        step = {
          action: 'audio.compress',
          params: {
            by: 'size',
            maxMB: Math.max(0.1, Math.round(mb * 10) / 10),
            quality: 'standard',
          },
        };
      } else if (p.action === 'video.trim') {
        step = { action: 'audio.trim', params: {} };
      } else if (p.action === 'pdf.merge') {
        step = { action: 'audio.merge', params: {} };
      }
    }
    if (p.action === 'image.compress' && (kind === 'video' || kind === 'pdf')) {
      const mb = Number(p.params.maxKB) / 1024;
      step =
        kind === 'video'
          ? {
              action: 'video.compress',
              params: { by: 'size', maxMB: Math.max(1, Math.round(mb)), quality: '720p' },
            }
          : {
              action: 'pdf.compress',
              params: { maxMB: Math.max(0.1, Math.round(mb * 10) / 10), whenTooBig: 'ask' },
            };
    }
    kind = kindAfter(step, kind);
    return step;
  });
}

/** 一串已有步骤之后的值大致是什么。 */
export function kindOfSteps(steps: readonly StepPhrase[]): PhraseKind | null {
  return steps.reduce<PhraseKind | null>((kind, step) => kindAfter(step, kind), null);
}

export function stepsFrom(phrases: readonly StepPhrase[]): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  for (const phrase of phrases) {
    const p = fitToPrevious(phrase, steps.at(-1));
    steps.push({
      id: stepIdFor(p.action, steps),
      action: p.action,
      params: p.params,
      ...(p.ask ? { ask: p.ask } : {}),
    });
  }
  return steps;
}

/** 预设的叫法（words）按这个顺序查：标了 wordsFirst 的先查，其余按预设的顺序。 */
const PRESETS_BY_WORDS = [
  ...WORKFLOW_PRESETS.filter((p) => p.words && p.wordsFirst),
  ...WORKFLOW_PRESETS.filter((p) => p.words && !p.wordsFirst),
];

export function findPreset(text: string): WorkflowPreset | undefined {
  const lower = text.toLowerCase();
  const byName = WORKFLOW_PRESETS.find(
    (p) => lower.includes(p.name.zh.toLowerCase()) || lower.includes(p.name.en.toLowerCase()),
  );
  if (byName) return byName;
  return PRESETS_BY_WORDS.find((p) => p.words!.test(text));
}

/** 按名字找工作流（完全相同优先，其次包含）。 */
export function findWorkflowByName(rawName: string, config: WorkspaceConfig): Workflow | undefined {
  const name = rawName
    .replace(/"/g, '')
    .replace(/(?:快捷操作|工作流|流程|workflow|quick action)$/i, '')
    .trim()
    .toLowerCase();
  if (!name) return undefined;
  const all = quickActionsOf(config);
  return (
    all.find((w) => w.name.toLowerCase() === name) ??
    all.find((w) => w.name.toLowerCase().includes(name) || name.includes(w.name.toLowerCase()))
  );
}
