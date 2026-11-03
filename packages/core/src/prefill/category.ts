import type { Field } from '../schema';
import type { ModelRequest } from './model';

// 分类字段（单选，概念 category）的候选（D-405）：先用代码里的词表（店名区和票面上印的词），拿不准再问本机模型。
// 词表和提示词是在研究目录 prefill-rules-research/step6-classify 里量过再搬进来的，改了要重新量。
// 只有选项 ID 是默认分类的 ID（收据模版的六个）时才认得出；用户自己加的选项只靠名字交给模型选。
// 结果只进候选，用户点了才填（D-394、D-396）。

export type ChoiceField = Extract<Field, { type: 'choice' }>;

/** 默认分类的选项 ID；用户改了选项的名字，ID 不变，还是认得。 */
export const CATEGORY_IDS = [
  'dining',
  'grocery',
  'pharmacy',
  'other-shopping',
  'transport',
  'other',
] as const;
type CategoryId = (typeof CATEGORY_IDS)[number];
const isKnown = (id: string): id is CategoryId => (CATEGORY_IDS as readonly string[]).includes(id);

// 拉丁词的开头要在词边界（不用 lookbehind：Hermes 不一定支持）。
const L = (s: string) => `(?:^|[^\\p{L}\\p{N}])(?:${s})`;
const R = (...parts: string[]) => new RegExp(parts.join('|'), 'iu');

interface Lexicon {
  id: CategoryId;
  /** 店名区（前 6 排）里出现 3 分，只在别处出现 1 分。 */
  name?: RegExp;
  /** 票面上印了就是这一类的词，全文出现 3 分。 */
  strong?: RegExp;
  /** 全文出现 +1 分。 */
  body?: RegExp;
}

const LEXICON: readonly Lexicon[] = [
  {
    id: 'dining',
    name: R(
      L(
        'restaur|bistro|brasserie|brewery|caf[eé]|caff|coffee|pizz|burger|sushi|ramen|grill|kitchen|diner|steak|taverna|trattoria|osteria|pub\\b|bar\\b|bakery|boulangerie|patisserie|noodle|kebab|bbq|taqueria|cantina|gasthaus|canteen|cafeteria|donut|doughnut',
      ),
      '餐|饭店|饭馆|面馆|酒楼|酒家|火锅|咖啡|茶饮|奶茶|小馆|食堂|居酒屋|寿司|鮨|ラーメン|焼肉|焼鳥|レストラン|カフェ|珈琲|うどん|そば|丼|定食|天ぷら|麺|ドーナツ',
    ),
    strong: R(
      L('service charge|gratuity|pourboire|couverts?\\b|propina|trinkgeld|covers?\\b'),
      '桌号|桌台|サービス料|お通し|テーブル|席料',
    ),
    body: R(L('table|tip\\b|guests?\\b|mesa|servicio'), '人数|ドリンク|飲食'),
  },
  {
    id: 'grocery',
    name: R(
      L(
        'supermarket|supermarch|hypermarch|supermercado|grocery|groceries|convenience|carrefour|lidl|aldi|leclerc|auchan|intermarch|monoprix|walmart|costco|tesco|kroger|safeway|trader joe|whole foods|7-?eleven|familymart|lawson|ministop|mart\\b|market\\b|march[eé]\\b|[eé]picerie',
      ),
      '超市|便利店|商超|生鲜|全家|罗森|スーパー|コンビニ|マート|マーケット|生協|イオン|セブン|ローソン|ファミリーマート|ファミマ|ミニストップ|デイリーヤマザキ',
    ),
  },
  {
    id: 'pharmacy',
    name: R(
      L('pharmac|farmac|apothek|chemist|parapharmacie|boots\\b|cvs|walgreens|rite aid|rossmann'),
      'drug|药|藥|薬|ドラッグ|クスリ|調剤|ファーマシー|化粧品|コスメ',
    ),
  },
  {
    id: 'transport',
    name: R(
      L(
        'parking|parcm[eè]tre|taxi|uber|lyft|didi|grab\\b|sncf|railway|metro\\b|m[eé]tro\\b|airline|airways|toll|p[eé]age|autoroute|tankstelle|gasolinera|shell\\b|esso\\b|total ?energies|bp\\b|eneos|idemitsu|cosmo ?oil|gas station|petrol station|station.service',
      ),
      '停车|停車|駐車|パーキング|出租|打车|滴滴|加油|铁路|鉄道|地铁|高铁|高速|航空|エネオス|出光|タクシー|ガソリンスタンド|ガスステーション|コスモ石油|石油',
    ),
    strong: R(
      L(
        'fuel|gasoline|petrol|diesel|gazole|carburant|unleaded|litres?\\b|liters?\\b|essence\\b|parking|taxi|fare\\b',
      ),
      '汽油|柴油|ガソリン|軽油|ハイオク|レギュラー|リットル|給油|運賃|メーター|乗車|入庫|出庫|駐車|车牌|里程',
    ),
  },
  {
    id: 'other-shopping',
    name: R(
      L(
        'bookstore|librairie|electronics|apparel|clothing|fashion|shoes|furniture|hardware|bricolage|stationery|papeterie|boutique|outlet|decathlon|ikea|zara|h&m|uniqlo|muji',
      ),
      '书店|書店|服饰|服装|鞋|家居|电器|ユニクロ|無印|ニトリ|百均|ダイソー|セリア|ホームセンター|家電|文具|ブック',
    ),
  },
  {
    id: 'other',
    name: R(
      L(
        'cinema|karaoke|hotel|hospital|clinic|dental|salon|barber|laundry|repair|post ?office|fitness|gym\\b|school|university|museum|theat(er|re)|lawyer|insurance|bank\\b',
      ),
      '电影|影院|映画|シネマ|カラオケ|ホテル|病院|医院|クリニック|歯科|美容|ヘアカラー|理髪|クリーニング|修理|郵便|役所|市役所|区役所|ジム|学校|保険|銀行|旅館|宿|酒店|诊所|保险|银行',
    ),
  },
];

/** 代码有把握的门槛（测量的：第一名 ≥ 3 分、领先 ≥ 2 分）。 */
const SURE_TOP = 3;
const SURE_GAP = 2;

/** 词表认出的默认分类 ID；没把握时 null。 */
export function categoryByLexicon(rows: readonly string[]): CategoryId | null {
  const lines = rows.map((r) => r.normalize('NFKC').trim()).filter(Boolean);
  const head = lines.slice(0, 6).join('\n');
  const all = lines.join('\n');
  const scores: [CategoryId, number][] = [];
  for (const r of LEXICON) {
    let s = 0;
    if (r.name?.test(head)) s += 3;
    else if (r.name?.test(all)) s += 1;
    if (r.strong?.test(all)) s = Math.max(s, 3);
    if (r.body?.test(all)) s += 1;
    if (s > 0) scores.push([r.id, s]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  const first = scores[0];
  if (!first || first[1] < SURE_TOP || first[1] - (scores[1]?.[1] ?? 0) < SURE_GAP) return null;
  return first[0];
}

/** 代码认出的分类，换成这个字段里对应的选项 ID（选项被删了就是 null）。 */
export function categoryByCode(field: ChoiceField, rows: readonly string[]): string | null {
  const id = categoryByLexicon(rows);
  return id !== null && field.options.some((o) => o.id === id) ? id : null;
}

/** 这个字段能不能问模型：至少两个选项能分清名字。 */
export const canAskCategory = (field: ChoiceField): boolean => categoryChoices(field).length >= 2;

// 提示词里的说明（英文，模型读英文最稳；量的时候中文、法文名字比英文名字差，所以认得的默认分类一律用英文名）。
const DESCRIPTIONS: Record<CategoryId, string> = {
  dining:
    'restaurant, cafe, bar, bakery counter, takeaway or any place that serves prepared food and drinks. Signs: table, guests, service charge, tip, dishes and drinks as items.',
  grocery:
    'supermarket, convenience store or discount store. Signs: many small items of food, drink, snacks and daily goods, loyalty points, reduced-rate food items.',
  pharmacy:
    'drugstore or pharmacy. Signs: medicine, cosmetics, skin care, toiletries, health and beauty products, daily goods, loyalty points.',
  'other-shopping':
    'any other shop selling goods: clothes, shoes, electronics, books, stationery, furniture, hardware, sports, gifts, variety stores, department stores.',
  transport: 'trains, buses, taxis, parking, tolls, highway, fuel, flights, rides.',
  other:
    'services and places that do not sell goods: post office, government office, cinema, karaoke, hotel, hospital, hair salon, repair, school, gym, bills, rent, contracts, letters, reports, notes, work, or nothing in the text shows a shop or a trip.',
};

const cleanName = (label: string) =>
  label
    .replace(/[\r\n]+/g, ' ')
    .replace(/<\|/g, '')
    .replace(/["\\]/g, '')
    .trim();

/** 问模型时每个选项叫什么：认得的默认分类用英文名，其他用用户起的名字；重名的只留第一个。 */
function categoryChoices(field: ChoiceField): { id: string; name: string; known: boolean }[] {
  const out: { id: string; name: string; known: boolean }[] = [];
  for (const o of field.options) {
    const known = isKnown(o.id);
    const name = known ? o.id.replace(/-/g, '_') : cleanName(o.label);
    if (name && !out.some((c) => c.name === name)) out.push({ id: o.id, name, known });
  }
  return out;
}

const SYSTEM =
  'You read the OCR text of one receipt or document and choose the one category it belongs to. ' +
  'Use only what is written in the text. Output only the category.';

/** 问分类的完整请求：语法把回答限制在这个字段当前的选项名里。手写 ChatML，空的 think 块等于关掉 thinking。 */
export function categoryRequest(
  field: ChoiceField,
  rows: readonly string[],
  textChars: number,
): ModelRequest {
  const choices = categoryChoices(field);
  const list = choices
    .map((c) => `- ${c.name}${c.known ? `: ${DESCRIPTIONS[c.id as CategoryId]}` : ''}`)
    .join('\n');
  return {
    prompt:
      `<|im_start|>system\n${SYSTEM}<|im_end|>\n` +
      `<|im_start|>user\nTEXT:\n${rows.join('\n').slice(0, textChars)}\n\nCategories:\n${list}\n\nWhich category?<|im_end|>\n` +
      '<|im_start|>assistant\n<think>\n\n</think>\n\n',
    grammar: `root ::= ${choices.map((c) => `"${c.name}"`).join(' | ')}`,
    temperature: 0,
    seed: 42,
    nPredict: 48,
    stop: ['\n', '<|im_end|>'],
  };
}

/** 模型的回答 → 选项 ID；不是选项名的回答丢掉（语法已经限制了，这里再核对一次）。 */
export function categoryAnswers(field: ChoiceField, answer: string): string[] {
  const name = answer.trim();
  const hit = categoryChoices(field).find((c) => c.name === name);
  return hit ? [hit.id] : [];
}
