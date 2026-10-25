import { localize, type Locale, type PlanAbout } from '@morph/core';

import type { AIMode } from '../ai/settings';

// 从一个快捷操作或收件页面打开时（D-124）输入框里提示的例子。内置规则只认带「这个」的固定句式，
// ChangeScreen 会先用内置规则试一遍，只留下它真能做的句子。

const ABOUT_WORKFLOW: Record<'mock' | 'ai', Record<Locale, readonly string[]>> = {
  mock: {
    zh: ['把这个的大小改成 200KB', '在这个里加一步去掉定位', '把这个放到首页'],
    en: ['Put this quick action on the home page'],
    fr: ['Put this quick action on the home page'],
  },
  ai: {
    zh: ['再小一点', '最后加一步分享', '把它放到首页', '换个名字，叫「交给学校」'],
    en: ['Make it smaller', 'Share the result at the end', 'Put it on the home page'],
    fr: [
      'Réduisez encore la taille.',
      'Partagez le résultat à la fin.',
      'Ajoutez cette action à l’accueil.',
    ],
  },
};

const ABOUT_SHARED: Record<'images' | 'pdfs' | 'mixed', Record<Locale, readonly string[]>> = {
  images: {
    zh: ['做成一个 PDF', '压到 500KB 再分享', '拼成一张长图', '去掉定位再分享'],
    en: ['Make one PDF', 'Compress to 500 KB, then share', 'Stitch them into one long image'],
    fr: [
      'Créer un seul PDF',
      'Compresser à 500 Ko puis partager',
      'Assembler en une image verticale',
    ],
  },
  pdfs: {
    zh: ['合成一个 PDF', '加上页码', '压小一点再分享'],
    en: ['Combine them into one PDF', 'Add page numbers', 'Make them smaller, then share'],
    fr: [
      'Assembler en un seul PDF',
      'Ajouter des numéros de page',
      'Réduire la taille puis partager',
    ],
  },
  mixed: {
    zh: ['合成一个 PDF', '打包成 ZIP 再分享'],
    en: ['Combine everything into one PDF', 'Zip them and share'],
    fr: ['Tout assembler en un seul PDF', 'Créer un ZIP puis partager'],
  },
};

const OFFLINE_SHARED: Record<Locale, readonly string[]> = {
  zh: ['新建一个快捷操作：选照片，压到 500KB，分享', '新建一个快捷操作：选照片，去掉定位，分享'],
  en: ['Create a quick action: choose photos, convert to JPG, remove location, zip, share'],
  fr: ['Create a quick action: choose photos, convert to JPG, remove location, zip, share'],
};

/** 放到首页、拼长图这类例子只在说得通时给（已经在首页、只有一张照片时不给）。 */
const ON_HOME = /首页|home page|accueil/i;
const STITCH = /拼成|stitch|image verticale/i;

export function aboutCandidates(
  about: PlanAbout,
  mode: AIMode,
  locale: Locale,
  { onHome = false }: { onHome?: boolean } = {},
): readonly string[] {
  if (about.kind === 'chain') return [];
  if (about.kind === 'workflow') {
    const all = localize(ABOUT_WORKFLOW[mode === 'mock' ? 'mock' : 'ai'], locale);
    return onHome ? all.filter((e) => !ON_HOME.test(e)) : all;
  }
  if (mode === 'mock')
    return about.images > 0 && about.pdfs + about.others === 0
      ? localize(OFFLINE_SHARED, locale)
      : [];
  const kind =
    about.pdfs + about.others === 0
      ? 'images'
      : about.images + about.others === 0
        ? 'pdfs'
        : 'mixed';
  const all = localize(ABOUT_SHARED[kind], locale);
  return about.images < 2 ? all.filter((e) => !STITCH.test(e)) : all;
}
