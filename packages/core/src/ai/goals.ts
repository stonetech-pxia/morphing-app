import { localize } from '../localization';
import { t } from '../messages';
import type { Op } from '../ops';
import type { IconName, Locale, Localized, Workflow } from '../schema';
import { newWorkflowId } from '../workflows/presets';
import type { Plan, PlanContext } from './types';

// 「我有什么，我想要什么」的目标句（D-149）：一句简单的目标，搭出一个能直接用的多步快捷操作。
// 原来是新手引导第 2 步的句子和 AI 修改页的例子（D-231、D-233 起都不再显示）；用户自己这么说时内置规则照样认得。
// 内置规则只认这几句（和相近的说法）；别的目标说法交给真实模型（planner 规则 22）。

export type GoalId = 'trip-photos' | 'big-video' | 'contracts';

export interface Goal {
  id: GoalId;
  /** 原句（测试用这个说法）。 */
  text: Localized;
  /** 整句匹配；都以「我」开头，不会抢走「添加视频太大发不出去快捷操作」这类句子。 */
  match: readonly RegExp[];
  name: Localized;
  icon: IconName;
  steps(locale: Locale): Workflow['steps'];
  /** 预览里的说明：AI 自己补上的步骤为什么要加（D-110，最多 2 句）。 */
  notes: readonly Localized[];
}

const share = { id: 'share', action: 'out.share', params: {} };
const rename = (template: string) => ({ id: 'name', action: 'file.rename', params: { template } });

export const GOALS: readonly Goal[] = [
  {
    id: 'trip-photos',
    text: {
      zh: '我有一堆旅行照片，想发给朋友',
      en: 'I have a bunch of trip photos to send to friends',
      fr: 'J’ai plein de photos de voyage à envoyer à mes amis',
    },
    match: [
      /^我有(?:一堆|很多|好多|一些|几张|一大堆)?(?:旅行|旅游|出去玩)的?照片.*(?:发给|分享给|传给|给)(?:朋友|家人|大家)/,
      /^i have (?:a bunch of |lots of |a lot of |some |many )?(?:trip|travel|vacation|holiday) (?:photos|pictures)\b.*\b(?:send|share)\b/i,
    ],
    name: {
      zh: '发旅行照片给朋友',
      en: 'Send trip photos to friends',
      fr: 'Envoyer des photos de voyage à des amis',
    },
    icon: 'photo',
    steps: (locale) => [
      { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 50 } },
      { id: 'jpg', action: 'image.convert', params: { format: 'jpeg', quality: 85 } },
      { id: 'clean', action: 'image.stripMetadata', params: {} },
      { id: 'size', action: 'image.resize', params: { mode: 'longEdge', px: 2048 } },
      { id: 'zip', action: 'zip.create', params: {} },
      rename(t(locale, 'goals_Trip_photos_4142c')),
      share,
    ],
    notes: [
      {
        zh: '转成 JPG，安卓手机和电脑也能打开。',
        en: 'Converted to JPG so Android phones and computers can open them.',
        fr: 'Converti en JPG pour que les téléphones Android et les ordinateurs puissent les ouvrir.',
      },
      {
        zh: '去掉了照片里的定位，别人看不到你在哪拍的。',
        en: 'Removed the location from the photos, so no one can see where you took them.',
        fr: 'Localisation supprimée des photos, personne ne peut voir où vous les avez prises.',
      },
    ],
  },
  {
    id: 'big-video',
    text: {
      zh: '我拍了一段视频，太大了发不出去',
      en: 'I shot a video and it’s too big to send',
      fr: 'J’ai filmé une vidéo, mais elle est trop lourde pour être envoyée',
    },
    match: [
      /^我(?:拍了|录了|有)(?:一段|一个|几段|个|段)?视频.*(?:太大|发不出去|发不了)/,
      /^i (?:shot|took|recorded|filmed|have) (?:a |some )?videos?\b.*\b(?:too (?:big|large)|can[’']?t send|won[’']?t send)/i,
    ],
    name: {
      zh: '把视频压小再发',
      en: 'Shrink a video to send',
      fr: 'Compresser une vidéo pour l’envoyer',
    },
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
        fr: 'Réduite à moins de 20 Mo pour pouvoir passer par e-mail et les applications de messagerie.',
      },
      {
        zh: '存成 MP4，手机和电脑都能直接播放。',
        en: 'Saved as MP4, which plays on any phone or computer.',
        fr: 'Enregistrée en MP4, lisible sur n’importe quel téléphone ou ordinateur.',
      },
    ],
  },
  {
    id: 'contracts',
    text: {
      zh: '我有好几份 PDF 合同，想合成一份加上页码，发邮件给律师',
      en: 'I have several PDF contracts to combine into one with page numbers and email to my lawyer',
      fr: 'J’ai plusieurs contrats en PDF à fusionner en un seul avec la numérotation des pages, puis à envoyer par e-mail à mon avocat',
    },
    match: [
      /^我有(?:好几份|几份|一些|多份|很多份)\s*PDF.*(?:合成|合并成?|拼成)一份.*页码/i,
      /^i have (?:several|a few|some|many) (?:pdf|pdfs|pdf contracts|pdf files)\b.*\b(?:into one|combine|merge)\b.*\bpage numbers\b/i,
    ],
    name: {
      zh: '合同合成一份发律师',
      en: 'Contracts for my lawyer',
      fr: 'Contrats à envoyer à mon avocat',
    },
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
      rename(t(locale, 'goals_Contracts_3f8a8')),
      share,
    ],
    notes: [
      {
        zh: '压到 10 MB 以内，邮件附件放得下，文字还能选中。',
        en: 'Made smaller than 10 MB so it fits as an email attachment; the text stays selectable.',
        fr: 'Réduit à moins de 10 Mo pour tenir dans une pièce jointe d’e-mail ; le texte reste sélectionnable.',
      },
      {
        zh: '文件名带上日期，律师好找。',
        en: 'The file name carries the date, so it is easy to find later.',
        fr: 'Le nom du fichier contient la date, pour le retrouver facilement plus tard.',
      },
    ],
  },
];

/** 句子是这几个目标之一（或相近说法）时，返回对应的计划；否则 null，交给别的规则。 */
export function goalPlan(input: string, ctx: PlanContext): Plan | null {
  const text = input.trim().replace(/[。.!！]+$/, '');
  const goal = GOALS.find((g) => g.match.some((re) => re.test(text)));
  if (!goal) return null;
  const taken = ctx.config.workflows;
  const base = localize(goal.name, ctx.locale);
  let name = base;
  for (let i = 2; taken.some((w) => w.name === name); i++) name = `${base} ${i}`;
  const workflow: Workflow = {
    id: newWorkflowId(goal.id, taken),
    name,
    icon: goal.icon,
    steps: goal.steps(ctx.locale),
  };
  const ops: Op[] = [{ op: 'addWorkflow', workflow }];
  return { kind: 'ops', ops, notes: goal.notes.map((n) => localize(n, ctx.locale)) };
}
