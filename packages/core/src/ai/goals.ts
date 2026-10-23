import type { Op } from '../ops';
import type { IconName, Locale, Localized, Workflow } from '../schema';
import { newWorkflowId } from '../workflows/presets';
import type { Plan, PlanContext } from './types';

// 新手引导里的「我有什么，我想要什么」（D-149）：一句简单的目标，搭出一个能直接用的多步快捷操作。
// 内置规则只认这几句（和相近的说法）；别的目标说法交给真实模型（planner 规则 22）。

export type GuideGoalId = 'trip-photos' | 'big-video' | 'contracts';

export interface GuideGoal {
  id: GuideGoalId;
  /** 引导里显示、点一下就打进输入框的原句。 */
  text: Localized;
  /** 整句匹配；都以「我」开头，不会抢走「添加视频太大发不出去快捷操作」这类句子。 */
  match: readonly RegExp[];
  name: Localized;
  icon: IconName;
  steps(locale: Locale): Workflow['steps'];
  /** 预览里的说明：AI 自己补上的步骤为什么要加（D-110，最多 2 句）。 */
  notes: readonly Localized[];
  /** 引导里能不能用内置的示例文件运行（视频不带示例，太占安装包）。 */
  sample: 'photos' | 'pdfs' | null;
}

const t = (locale: Locale, en: string, zh: string) => (locale === 'zh' ? zh : en);
const share = { id: 'share', action: 'out.share', params: {} };
const rename = (template: string) => ({ id: 'name', action: 'file.rename', params: { template } });

export const GUIDE_GOALS: readonly GuideGoal[] = [
  {
    id: 'trip-photos',
    text: {
      zh: '我有一堆旅行照片，想发给朋友',
      en: 'I have a bunch of trip photos to send to friends',
    },
    match: [
      /^我有(?:一堆|很多|好多|一些|几张|一大堆)?(?:旅行|旅游|出去玩)的?照片.*(?:发给|分享给|传给|给)(?:朋友|家人|大家)/,
      /^i have (?:a bunch of |lots of |a lot of |some |many )?(?:trip|travel|vacation|holiday) (?:photos|pictures)\b.*\b(?:send|share)\b/i,
    ],
    name: { zh: '发旅行照片给朋友', en: 'Send trip photos to friends' },
    icon: 'photo',
    steps: (locale) => [
      { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 50 } },
      { id: 'jpg', action: 'image.convert', params: { format: 'jpeg', quality: 85 } },
      { id: 'clean', action: 'image.stripMetadata', params: {} },
      { id: 'size', action: 'image.resize', params: { mode: 'longEdge', px: 2048 } },
      { id: 'zip', action: 'zip.create', params: {} },
      rename(t(locale, 'Trip photos {date}', '旅行照片-{date}')),
      share,
    ],
    notes: [
      {
        zh: '转成 JPG，安卓手机和电脑也能打开。',
        en: 'Converted to JPG so Android phones and computers can open them.',
      },
      {
        zh: '去掉了照片里的定位，别人看不到你在哪拍的。',
        en: 'Removed the location from the photos, so no one can see where you took them.',
      },
    ],
    sample: 'photos',
  },
  {
    id: 'big-video',
    text: {
      zh: '我拍了一段视频，太大了发不出去',
      en: 'I shot a video and it’s too big to send',
    },
    match: [
      /^我(?:拍了|录了|有)(?:一段|一个|几段|个|段)?视频.*(?:太大|发不出去|发不了)/,
      /^i (?:shot|took|recorded|filmed|have) (?:a |some )?videos?\b.*\b(?:too (?:big|large)|can[’']?t send|won[’']?t send)/i,
    ],
    name: { zh: '把视频压小再发', en: 'Shrink a video to send' },
    icon: 'video',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      {
        id: 'compress',
        action: 'video.compress',
        params: { by: 'size', maxMB: 20, quality: '720p' },
      },
      share,
    ],
    notes: [
      {
        zh: '压到 20 MB 以内，邮件和聊天都发得动。',
        en: 'Made smaller than 20 MB so it goes through email and chat apps.',
      },
      {
        zh: '存成 MP4，手机和电脑都能直接播放。',
        en: 'Saved as MP4, which plays on any phone or computer.',
      },
    ],
    sample: null,
  },
  {
    id: 'contracts',
    text: {
      zh: '我有好几份 PDF 合同，想合成一份加上页码，发邮件给律师',
      en: 'I have several PDF contracts to combine into one with page numbers and email to my lawyer',
    },
    match: [
      /^我有(?:好几份|几份|一些|多份|很多份)\s*PDF.*(?:合成|合并成?|拼成)一份.*页码/i,
      /^i have (?:several|a few|some|many) (?:pdf|pdfs|pdf contracts|pdf files)\b.*\b(?:into one|combine|merge)\b.*\bpage numbers\b/i,
    ],
    name: { zh: '合同合成一份发律师', en: 'Contracts for my lawyer' },
    icon: 'document',
    steps: (locale) => [
      { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 2, max: 20 } },
      { id: 'merge', action: 'pdf.merge', params: {} },
      {
        id: 'numbers',
        action: 'pdf.pageNumbers',
        params: {
          position: 'bottomCenter',
          format: 'nOfTotal',
          startAt: 1,
          fontSize: 10,
          skipFirst: false,
        },
      },
      { id: 'compress', action: 'pdf.compress', params: { maxMB: 10, whenTooBig: 'ask' } },
      rename(t(locale, 'Contracts {date}', '合同-{date}')),
      share,
    ],
    notes: [
      {
        zh: '压到 10 MB 以内，邮件附件放得下，文字还能选中。',
        en: 'Made smaller than 10 MB so it fits as an email attachment; the text stays selectable.',
      },
      {
        zh: '文件名带上日期，律师好找。',
        en: 'The file name carries the date, so it is easy to find later.',
      },
    ],
    sample: 'pdfs',
  },
];

export const guideGoal = (id: GuideGoalId) => GUIDE_GOALS.find((g) => g.id === id)!;

/** 句子是引导里的目标之一（或相近说法）时，返回对应的计划；否则 null，交给别的规则。 */
export function goalPlan(input: string, ctx: PlanContext): Plan | null {
  const text = input.trim().replace(/[。.!！]+$/, '');
  const goal = GUIDE_GOALS.find((g) => g.match.some((re) => re.test(text)));
  if (!goal) return null;
  const taken = ctx.config.workflows;
  const base = goal.name[ctx.locale];
  let name = base;
  for (let i = 2; taken.some((w) => w.name === name); i++) name = `${base} ${i}`;
  const workflow: Workflow = {
    id: newWorkflowId(goal.id, taken),
    name,
    icon: goal.icon,
    steps: goal.steps(ctx.locale),
  };
  const ops: Op[] = [{ op: 'addWorkflow', workflow }];
  return { kind: 'ops', ops, notes: goal.notes.map((n) => n[ctx.locale]) };
}
