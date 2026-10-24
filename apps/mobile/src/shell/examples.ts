import type { Locale, PlanAbout } from '@morph/core';

import type { AIMode } from '../ai/settings';

// AI 修改页「可以试试：」的例子（D-107）。外观交给上面的风格选择器（D-095），这里放「帮我做事」的说法。
// 内置规则只认固定句式，所以离线时只给它认得的句子（测试逐句检查）；真实 AI 给「我有什么、想要什么」的说法。

export const OFFLINE_EXAMPLES: Record<Locale, readonly string[]> = {
  zh: [
    '我有一堆旅行照片，想发给朋友',
    '添加签证照片快捷操作',
    '把批量发照片放到首页',
    '新建一个快捷操作：扫描文档，压到 300KB，存到文件',
    '新建一个记账页面',
    '字体大一点',
    '撤销刚才的修改',
  ],
  en: [
    'I have a bunch of trip photos to send to friends',
    'Add the visa photo quick action',
    'Put the send many photos quick action on the home page',
    'Create a quick action: scan documents, make a PDF, share',
    'Add a budget page',
    'Bigger text',
    'Undo the last change',
  ],
};

export const AI_EXAMPLES: Record<Locale, readonly string[]> = {
  zh: [
    '身份证正反面两张照片，学校要一个 PDF，不能超过 2MB',
    '纸质合同要签字后发回',
    '要申请美国签证，我有一张自拍',
    '几张照片要发邮件，帮我压小一点',
    '字体大一点',
    '撤销刚才的修改',
  ],
  en: [
    'Front and back of my ID card, the school wants one PDF under 2 MB',
    'A paper contract I need to sign and send back',
    'Applying for a US visa, I have a selfie',
    'Shrink a few photos so I can email them',
    'Bigger text',
    'Undo the last change',
  ],
};

export function examplesFor(mode: AIMode, locale: Locale): readonly string[] {
  return (mode === 'mock' ? OFFLINE_EXAMPLES : AI_EXAMPLES)[locale];
}

// 从一个快捷操作或收件页面打开时（D-124）的例子。内置规则只认带「这个」的固定句式，
// ChangeScreen 会先用内置规则试一遍，只留下它真能做的句子。

const ABOUT_WORKFLOW: Record<'mock' | 'ai', Record<Locale, readonly string[]>> = {
  mock: {
    zh: ['把这个的大小改成 200KB', '在这个里加一步去掉定位', '把这个放到首页'],
    en: ['Put this quick action on the home page'],
  },
  ai: {
    zh: ['再小一点', '最后加一步分享', '把它放到首页', '换个名字，叫「交给学校」'],
    en: ['Make it smaller', 'Share the result at the end', 'Put it on the home page'],
  },
};

const ABOUT_SHARED: Record<'images' | 'pdfs' | 'mixed', Record<Locale, readonly string[]>> = {
  images: {
    zh: ['做成一个 PDF', '压到 500KB 再分享', '拼成一张长图', '去掉定位再分享'],
    en: ['Make one PDF', 'Compress to 500 KB, then share', 'Stitch them into one long image'],
  },
  pdfs: {
    zh: ['合成一个 PDF', '加上页码', '压小一点再分享'],
    en: ['Combine them into one PDF', 'Add page numbers', 'Make them smaller, then share'],
  },
  mixed: {
    zh: ['合成一个 PDF', '打包成 ZIP 再分享'],
    en: ['Combine everything into one PDF', 'Zip them and share'],
  },
};

const OFFLINE_SHARED: Record<Locale, readonly string[]> = {
  zh: ['新建一个快捷操作：选照片，压到 500KB，分享', '新建一个快捷操作：选照片，去掉定位，分享'],
  en: ['Create a quick action: choose photos, convert to JPG, remove location, zip, share'],
};

/** 放到首页、拼长图这类例子只在说得通时给（已经在首页、只有一张照片时不给）。 */
const ON_HOME = /首页|home page/i;
const STITCH = /拼成|stitch/i;

export function aboutCandidates(
  about: PlanAbout,
  mode: AIMode,
  locale: Locale,
  { onHome = false }: { onHome?: boolean } = {},
): readonly string[] {
  if (about.kind === 'workflow') {
    const all = ABOUT_WORKFLOW[mode === 'mock' ? 'mock' : 'ai'][locale];
    return onHome ? all.filter((e) => !ON_HOME.test(e)) : all;
  }
  if (mode === 'mock')
    return about.images > 0 && about.pdfs + about.others === 0 ? OFFLINE_SHARED[locale] : [];
  const kind =
    about.pdfs + about.others === 0
      ? 'images'
      : about.images + about.others === 0
        ? 'pdfs'
        : 'mixed';
  const all = ABOUT_SHARED[kind][locale];
  return about.images < 2 ? all.filter((e) => !STITCH.test(e)) : all;
}
