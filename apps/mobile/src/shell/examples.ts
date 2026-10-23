import type { Locale } from '@morph/core';

import type { AIMode } from '../ai/settings';

// AI 修改页「可以试试：」的例子（D-107）。外观交给上面的风格选择器（D-095），这里放「帮我做事」的说法。
// 内置规则只认固定句式，所以离线时只给它认得的句子（测试逐句检查）；真实 AI 给「我有什么、想要什么」的说法。

export const OFFLINE_EXAMPLES: Record<Locale, readonly string[]> = {
  zh: [
    '添加签证照片快捷操作',
    '把照片发邮件放到首页',
    '新建一个快捷操作：扫描文档，压到 300KB，存到文件',
    '新建一个记账页面',
    '字体大一点',
    '撤销刚才的修改',
  ],
  en: [
    'Add the visa photo quick action',
    'Put the photos for email quick action on the home page',
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
