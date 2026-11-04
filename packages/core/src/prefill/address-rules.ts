import type { CardDoc, Unit } from './card-rules';
import { hasCompany, hasJob } from './card-rules';
import type { ValueSuggestion } from './rank';

// 名片地址候选（规则 A-01…A-08）。
// 不用后行断言；全部同步；不写数据，不联网。多行地址用 \n 连接。
//   A-01 多行拼接（街道行 + 邮编城市行 + 国家/楼层行）
//   A-02 邮编和城市格式（法西德意 5 位、奥瑞 4 位、英美加澳葡荷巴西…）
//   A-03 多语言街道词 + 门牌号前后写法（含缩写）
//   A-04 标签词（address/adresse/dirección/indirizzo/anschrift/morada/地址…），去掉标签；单独一行的标签取下一行
//   A-05 排除陷阱（公司名/口号里的街道词、服务区域、电话、邮箱、网址行）
//   A-06 中文/日韩地址（省市区路街号楼室，数字可以是汉字，繁体）
//   A-07 丢掉通用打分给的杂项候选（地址栏里的职位、域名等）
//   A-08 地址行尾巴上的电话/网址切掉

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const squash = (s: string) => fold(s).replace(/[^\p{L}\p{N}]/gu, '');
const CJK = /[㐀-鿿]/;
const KANA = /[぀-ヿ]/;
const HANGUL = /[가-힯]/;

// ---------- 标签 ----------
const LAB_PREFIX =
  '(?:(?:postal|mailing|business|office|studio|street|home|visiting|registered|billing|company|head\\s*office)\\s+)?';
// 完整的词：后面的分隔符可有可无
const LABEL_FULL = new RegExp(
  `^${LAB_PREFIX}(?:address|adresse|adres|direcci[oó]n|direccion|domicilio|indirizzo|anschrift|besuchsadresse|postanschrift|morada|endere[cç]o|moradia)(?:\\s+(?:postale|comercial|fiscal|legale|professionnelle))?\\s*[:：.\\-–—|]*\\s*`,
  'i',
);
// 短写法：必须有 : 或 . 才算标签（Add: 、Addr. 、A:）
const LABEL_SHORT = /^(?:addr|add|adr|dir|ind)\s*[:：.]\s*|^A\s*[:：]\s*/i;
const LABEL_CJK =
  /^[一-鿿]{0,4}(?:地\s*址|住\s*址|通訊處|通讯处|廠址|厂址|所在地|住所)\s*[:：]?\s*/;
const LABEL_KO = /^주소\s*[:：]?\s*/;
const LABEL_JA = /^〒?\s*(?:住所|所在地)\s*[:：]?\s*/;

/** 去掉开头的符号和标签；返回值和是否有标签（labelOnly = 标签单独占一行）。 */
function stripLabel(t0: string): { text: string; labeled: boolean; labelOnly: boolean } {
  let t = t0
    .trim()
    .replace(/^[\s•·▪■◆►▶➤✦★☆📍🏠•*>~|-]+/u, '')
    .trim();
  for (const re of [LABEL_FULL, LABEL_SHORT, LABEL_CJK, LABEL_KO, LABEL_JA]) {
    const m = t.match(re);
    if (m && m[0].length > 0) {
      const rest = t.slice(m[0].length).trim();
      // 短写法 A: 后面必须还有内容（或本来就是单独的）
      return { text: rest, labeled: true, labelOnly: rest.length === 0 };
    }
  }
  return { text: t, labeled: false, labelOnly: false };
}

// ---------- 不是地址的行 ----------
const CONTACT_LABEL =
  /^(?:tel|tél|tlf|telf|telefon|telefono|teléfono|telefone|phone|ph|mob|mobile|móvil|movil|portable|cell|cel|celular|handy|fax|whatsapp|email|e-mail|mail|courriel|correo|web|www|site|url|电话|電話|手机|手機|傳真|传真|邮箱|郵箱|電郵|网址|網址|携帯|メール|이메일)\b\s*[.:：]?/i;
const CONTACT_CJK =
  /^(?:电话|電話|手机|手機|傳真|传真|邮箱|郵箱|電郵|网址|網址|携帯|メール|이메일)/;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const URLISH =
  /(?:https?:\/\/|www\.)\S+|(?:^|[\s/(])[a-z0-9][a-z0-9-]*\.(?:com|net|org|info|biz|eu|fr|es|de|it|pt|nl|ch|at|be|uk|co|io|ca|us|au|br|ar|mx|cn|tw|hk|jp|kr|ma|tn|ae|app|dev|shop|studio|design|agency|online|site)(?:\/\S*)?(?=$|[\s,;)])/i;
const SLOGAN =
  /(?:^|[^a-z])(?:since|established|founded|depuis|desde|seit|sinds|serving|proudly|we|our|your|nous|votre|notre|nuestro|nuestra|unser|unsere|wir|ihr|vous|you|open|hours|horaires|service area|services?|emergency|24\/7|24\s*(?:h|horas|std|stunden|heures|uur|ore)\b|livrons|atendemos|ofrecemos)(?:$|[^a-z])|服務地區|服务地区|服務範圍|服务范围|營業時間|营业时间|提供|歡迎|欢迎/i;
const LEGAL =
  /(?:^|[^a-z0-9])(?:ltd|limited|llc|llp|inc|corp|gmbh|ag|sarl|sas|sasu|srl|spa|bv|nv|pty|plc|lda|ltda|s\.a\.|s\.l\.)\.?(?=$|[^a-z0-9])/;

function phoneLike(t: string): boolean {
  const digits = (t.match(/\d/g) ?? []).length;
  const body = t.replace(/\s+/g, '').length;
  if (/^\+?\(?\d[\d\s().\-/]{5,}$/.test(t.trim())) return true;
  return digits >= 7 && digits > 0.6 * body;
}

// ---------- 街道词 ----------
// 街名词在名前（法西意葡）：长写法随便出现；短写法必须带 . 或 /
const PRE_LONG = new Set(
  'rue avenue boulevard impasse chemin quai allee cours passage voie route calle avenida avda avd paseo carrer camino cmno carretera ctra ronda travesia glorieta urbanizacion poligono carrera diagonal transversal rua travessa alameda estrada rodovia praceta beco via viale piazza piazzale vicolo strada lungomare lungotevere contrada localita plaza praca largo place square bd bvd blvd bld rte lungarno corso rambla vial'.split(
    ' ',
  ),
);
const AMBIG_PRE = new Set(
  'cours place square passage voie route largo plaza rambla vial diagonal transversal'.split(' '),
);
const PRE_SHORT = new Set(
  'r c cl ch pl pza pso ps pc tv dg cr cra kra est rod res all urb pol loc v vle cso av avda avd bd cmno ctra trv pzza'.split(
    ' ',
  ),
);
// 英语：街名在前、词在后
const EN_STRONG = new Set(
  'street avenue ave road rd boulevard blvd lane ln highway hwy parkway pkwy terrace crescent cres'.split(
    ' ',
  ),
);
const EN_WEAK = new Set(
  'drive dr court ct place pl way circle cir close square sq trail trl alley row mews gardens gdns grove wharf plaza park hill walk pike path loop promenade quay gate parade rise green yard embankment broadway circus approach'.split(
    ' ',
  ),
);
// 德荷：复合词词尾
const COMPOUND =
  /^[a-zß-]{2,}(?:strasse|straße|str|platz|weg|allee|gasse|ring|damm|ufer|chaussee|steig|pfad|markt|straat|laan|gracht|plein|singel|kade|dijk|steeg|baan|hof)$/;
const DE_WORD = new Set('strasse straße str platz weg allee gasse'.split(' '));
const NL_WORD = new Set('singel laan plein gracht kade dijk steeg straat weg'.split(' '));
const DE_WORD_NUM = new Set(['ring', 'damm', 'ufer']); // 单独的词：只有后面有门牌号才算（Kärntner Ring 5）
const CONNECT = new Set(
  'de del della delle di da do dos das du des la le el los las y e et and of the van von der den ten ter d l saint sainte san santa sao são st'.split(
    ' ',
  ),
);
const DE_PARTICLE =
  /^(?:Am|An der|An den|Auf dem|Auf der|Im|In der|Zum|Zur|Unter den|Hinter dem|Beim)\s+\p{Lu}[\p{L}'’.-]*/u;
// 路名词后面直接跟的数字是路线号（Route 66），不是门牌号
const ROUTE_WORD = new Set('route rte ruta highway hwy autobahn rodovia'.split(' '));
const POBOX =
  /(?:^|[^a-z])(?:p\.?\s?o\.?\s*box|postfach|apartado(?:\s+(?:de\s+correos|postal))?|casilla(?:\s+de\s+correo)?|caixa\s+postal|case\s+postale|casella\s+postale|postbus|b\.?p\.?|c\.?s\.?|cedex)\s*n?[º°o]?\.?\s*\d+/i;

const HN =
  /^(?:n[º°o]?|nr|no|num|núm|#)?\.?#?(\d{1,5}[a-zA-Z]?(?:\s?[-–/]\s?\d{1,5}[a-zA-Z]?)?)\.?$/i;
const HN_MARK = /^(?:n[º°o]?|nr|no|num|núm|#)\.?$/i;
const HN_NONE = new Set(['s/n', 'snc', 's.n.', 's.n', 'sn']);

function tokenize(t: string): string[] {
  return t
    .replace(/\b(St|Rd|Ave|Str|Av|Blvd|Dr|Ln)\.(?=\d)/g, '$1. ')
    .replace(/(^|\s)P[º°]\.?(?=\s)/g, '$1Paseo')
    .split(/[\s,;|]+/)
    .filter(Boolean);
}
const key = (tok: string) =>
  fold(tok)
    .replace(/\./g, '')
    .replace(/[:/]+$/, '');
const isCap = (tok: string) => /^[A-ZÀ-ÖØ-Þ0-9]/.test(tok);
const isOrdinal = (tok: string) => /^\d+(?:st|nd|rd|th|e|er|ème|eme|ª|º|°)$/i.test(tok);

/** HN 和街名词之间的词都像名字（大写、数字、连接词），不像口号里的小写词。 */
function nameTokensOk(tok: string[], from: number, to: number): boolean {
  for (let j = from; j < to; j++) {
    const w = tok[j]!;
    if (
      isCap(w) ||
      CONNECT.has(key(w).replace(/['’]$/, '')) ||
      /^[a-z]\.?$/i.test(w) ||
      /^(?:n|no|nr|#)[º°o.]?\d*$/i.test(w) ||
      /^(?:bis|ter|quater)$/i.test(w)
    )
      continue;
    return false;
  }
  return true;
}
/** 门牌号：返回位置，没有为 -1。tok 为 token 数组，from..to 范围内找。 */
function findHN(tok: string[], from: number, to: number): number {
  for (let j = Math.max(0, from); j <= Math.min(tok.length - 1, to); j++) {
    const k = key(tok[j]!);
    if (HN_NONE.has(k)) return j;
    if (HN_MARK.test(k) && j + 1 < tok.length && /^\d/.test(tok[j + 1]!)) return j + 1;
    if (isOrdinal(tok[j]!)) continue;
    const m = tok[j]!.match(HN);
    if (!m) continue;
    const digits = m[1]!.replace(/\D/g, '');
    if (/^\d{5,}$/.test(m[1]!) && !/^(?:n|no|nr|#)/i.test(tok[j]!)) continue; // 5 位数当邮编，除非有 No./#
    if (digits.length > 5) continue;
    // 路线号
    if (j > 0 && ROUTE_WORD.has(key(tok[j - 1]!))) continue;
    return j;
  }
  return -1;
}

// ---------- 邮编城市 ----------
const P_STRONG: RegExp[] = [
  /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/, // 英国
  /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/, // 加拿大
  /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/, // 美国 州 + 邮编
  /\b\d{4}-\d{3}\b/, // 葡萄牙
  /\b\d{5}-\d{3}\b/, // 巴西
  /\b[1-9]\d{3}\s?[A-Z]{2}\b/, // 荷兰
  /\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+\d{4}\b/, // 澳洲
  /\b(?:CH|AT|A|BE|B|LU|L|DK|NO|SE|FI|DE|D|FR|F|ES|E|IT|I|PL|MA|TN|DZ|NL|PT|P)\s?[-–]\s?\d{4,5}\b/, // CH-8001 之类
  /\b(?:c\.?\s?p\.?|cep|plz|zip|npa|cap|code\s+postal)\s*:?\s*\d{4,6}\b/i,
  /\b[A-Z]\d{4}[A-Z]{3}\b/, // 阿根廷 C1425ABC
  /\b\d{2}-\d{3}\b/, // 波兰
];
const P5 = /(?:^|[^\d])(\d{5})(?!\d)/;
const P4 = /(?:^|[^\d])([1-9]\d{3})(?!\d)/;
const NOT_POSTAL =
  /(?:^|[^a-z])(?:siret|siren|rcs|vat|tva|nif|cif|iban|bic|tin|ein|reg|nr|no|n°|id|cnpj|cpf|ape|naf|capital|code|tel|fax|tél)\b/i;

function hasStrongPostal(t: string): boolean {
  return P_STRONG.some((re) => re.test(t));
}
/** 一行像「邮编 + 城市」：strong 的格式，或者 5 位数 + 城市词；ctx4 = 前面有街道行时 4 位数也算。 */
function postalCity(t: string, ctx4: boolean): boolean {
  if (
    t.length > 70 ||
    t.length < 4 ||
    EMAIL.test(t) ||
    URLISH.test(t) ||
    /[€$£¥]|\b(?:eur|euros?|usd|gbp)\b/i.test(t)
  )
    return false;
  if (CONTACT_LABEL.test(t) && !/^zip|^cap|^plz|^npa/i.test(t)) return false;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (letters < 2)
    return (
      hasStrongPostal(t) && /^[A-Z]\d[A-Z]?\s?\d[A-Z]{2}$|^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/.test(t.trim())
    );
  if (hasStrongPostal(t)) return true;
  const m5 = t.match(P5);
  if (m5 && !NOT_POSTAL.test(t.slice(0, Math.max(0, t.indexOf(m5[1]!))))) {
    const rest = t.replace(m5[1]!, ' ');
    return /[A-Za-zÀ-ÖØ-öø-ÿ]{3,}/.test(rest);
  }
  if (ctx4 && /^[A-ZÀ-ÖØ-Þ][\p{L} .'’-]{2,30}\s*(?:[-–,]\s*[A-Z]{2}|\([A-Z]{2}\))$/u.test(t.trim()))
    return true; // Rio de Janeiro - RJ / Milano (MI)
  if (ctx4 && /\b[A-Z][a-z]{3,}(?:\s[A-Z][a-z]+)?\s*[-,]?\s*\d{6}\b/.test(t) && t.length <= 40)
    return true; // Singapore 048616 / Hyderabad 500034
  if (ctx4) {
    const m4 = t.match(P4);
    if (m4 && !NOT_POSTAL.test(t.slice(0, Math.max(0, t.indexOf(m4[1]!)))))
      return /[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’.-]{2,}|[A-ZÀ-ÖØ-Þ]{3,}/.test(t.replace(m4[1]!, ' '));
  }
  return false;
}
/** 邮编在行里（不管有没有城市）。 */
function postalIn(t: string): boolean {
  return hasStrongPostal(t) || (P5.test(t) && !NOT_POSTAL.test(t.replace(/\d{5}.*/, '')));
}

const COUNTRIES = new Set(
  'france germany deutschland allemagne alemania alemanha italy italia italie spain espana espagne españa portugal switzerland suisse schweiz svizzera suiza suica austria osterreich autriche belgium belgique belgien belgica belgie netherlands nederland pays-bas holland paises-bajos luxembourg luxemburg united-kingdom uk england scotland wales ireland irlanda irlande usa united-states america canada australia australie brasil brazil bresil argentina argentine mexico mexique chile colombia peru uruguay maroc morocco marokko maroc tunisie tunisia algerie algeria egypt egypte sweden suede denmark norway finland poland pologne greece turkey japan china chine taiwan hong-kong singapore korea india uae iraq'
    .split(' ')
    .map((c) => c.replace(/-/g, ' ')),
);
function countryLine(t: string): boolean {
  const f = fold(t)
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!f || f.length > 30) return false;
  if (COUNTRIES.has(f)) return true;
  return false;
}
const UNIT_LINE =
  /^(?:suite|ste|unit|floor|fl|level|bldg|building|room|rm|apt|apartment|bat|batiment|immeuble|etage|escalier|piso|planta|puerta|oficina|of|local|edificio|edificacao|sala|interno|int|scala|piano|stock|raum|haus|zimmer|tower|torre|bloc|bloco|lote|andar|c\/o|co)\b/;
const BUILDING_LINE =
  /^(?:immeuble|batiment|bat\.|residence|edificio|edif\.|building|bldg|torre|tower|edificacao|gebaeude|centre|centro|center|parc|zone|zac|zi|za|domaine|lotissement|poligono|pol\. ind\.|parque|gewerbepark|industriegebiet|business park|industrial estate|science park|campus)\s+\S/;
function unitLine(t: string): boolean {
  if (
    BUILDING_LINE.test(fold(t)) &&
    t.length <= 40 &&
    !EMAIL.test(t) &&
    !URLISH.test(t) &&
    !hasCompany(t)
  )
    return true;
  const f = fold(t).replace(/^[\s.]+/, '');
  return (
    f.length <= 40 &&
    UNIT_LINE.test(f.replace(/\./g, '')) &&
    /\d|[a-z]/.test(f) &&
    !EMAIL.test(t) &&
    !URLISH.test(t) &&
    !phoneLike(t)
  );
}

// ---------- 街道行判断 ----------
interface Street {
  ok: boolean;
  /** 有街道词但没有门牌号和邮编（下一行是邮编城市时才算地址）。 */
  weak?: boolean;
  /** 证据强度：门牌号 + 街道词 = 3；街道词 + 邮编 = 2.8；PO box = 2.5 */
  s: number;
}
const NO: Street = { ok: false, s: 0 };

const SAINT = /\b(?:St|Dr)\.?\s+[A-ZÀ-Þ][a-zà-ÿ]/;
function streetLine(t: string): Street {
  if (t.length < 5 || t.length > 90) return NO;
  const tok = tokenize(t);
  if (tok.length < 2 || tok.length > 14) return NO;
  const postal = postalIn(t);
  let weakSeen = false;
  if (POBOX.test(t)) return { ok: true, s: 2.5 };
  const hn0 = findHN(tok, 0, 1);
  // 德语前置词：Am Markt 5
  if (DE_PARTICLE.test(t) && findHN(tok, 1, 5) >= 0) return { ok: true, s: 3 };
  for (let i = 0; i < tok.length; i++) {
    const k = key(tok[i]!);
    const raw = tok[i]!;
    // 英语：街名词在后
    if (i >= 1 && (EN_STRONG.has(k) || EN_WEAK.has(k) || k === 'st' || k === 'dr')) {
      if (
        (k === 'st' || k === 'dr') &&
        SAINT.test(t) &&
        i + 1 < tok.length &&
        isCap(tok[i + 1]!) &&
        !/^\d/.test(tok[i + 1]!) &&
        !unitLine(tok.slice(i + 1).join(' '))
      )
        continue; // St. Gallen（逗号分开的不算）
      if (k === 'dr' && i < 2) continue;
      if (i > 6) continue;
      if (hn0 >= 0 && hn0 < i && nameTokensOk(tok, hn0 + 1, i)) return { ok: true, s: 3 };
      const weak = EN_WEAK.has(k) || k === 'dr' || k === 'st';
      const strongWord =
        !weak || (k === 'st' && findHN(tok, i + 1, i + 1) === i + 1 && nameTokensOk(tok, 0, i));
      if (strongWord) {
        const trail = findHN(tok, i + 1, i + 3);
        if (
          postal ||
          (trail >= 0 && /^(?:#|no|nr|n[º°o])/i.test(tok[trail - 1] ?? '')) ||
          (trail >= 0 && trail === i + 1 && !/^\d{1,2}$/.test(tok[trail]!.replace(/\D/g, '')))
        )
          return { ok: true, s: postal ? 2.8 : 2.6 };
        if (trail >= 0) return { ok: true, s: 2.6 };
        if (i <= 5) weakSeen = true;
      }
      continue;
    }
    // 名前型：Rue/Calle/Via/Rua…，在第 0–3 个 token
    const shortOk = PRE_SHORT.has(k) && /[./]/.test(raw);
    // 1 route de Genève：门牌号紧挨在街名词前面（前面可以有别的字，Bureaux de la Colline, 1 route de Genève）
    if (
      i >= 2 &&
      i <= 9 &&
      (PRE_LONG.has(k) || shortOk) &&
      findHN(tok, i - 1, i - 1) === i - 1 &&
      !/^\d{5,}$/.test(tok[i - 1]!)
    )
      return { ok: true, s: 2.9 };
    if (i <= 3 && (PRE_LONG.has(k) || shortOk)) {
      if (
        i >= 1 &&
        !(
          hn0 >= 0 ||
          unitLine(tok.slice(0, i).join(' ')) ||
          /^(?:local|oficina|torre|piso|bloc|edificio|edif|sala|loja|suite|unit)$/i.test(
            key(tok[0]!),
          )
        )
      ) {
        // 街名词不在行首也不跟在门牌号后面：要有门牌号或邮编
        if (findHN(tok, i + 1, i + 6) < 0 && !postal) continue;
      }
      if (i >= 1 && !nameTokensOk(tok, 0, i)) continue; // Dal 1990 in Via Roma
      if (ROUTE_WORD.has(k) && hn0 < 0 && !postal) {
        // Route 66 Diner：路线号后面没有别的门牌号
        if (findHN(tok, i + 2, i + 6) < 0) continue;
      }
      const after = findHN(tok, i + 1, i + 7);
      if (hn0 >= 0 && hn0 < i) return { ok: true, s: 3 };
      if (after >= 0 && AMBIG_PRE.has(k) && !postal) {
        // Cours de cuisine - 8 places：常用名词做街名词时，门牌号后面只能是逗号、单位或结束
        const at = t.indexOf(tok[after]!, t.indexOf(raw));
        const tail = t.slice(at + tok[after]!.length).trim();
        if (tail && !/^[,;–—-]|^(?:bis|ter)\b|^[A-Za-z]{1,3}\b/i.test(tail)) continue;
      }
      if (after >= 0 && after < tok.length - 4 && !postal && findHN(tok, after + 1, tok.length) < 0)
        continue; // 门牌号后面还有一长串：口号、店名
      if (after >= 0 && /^(?:18|19|20)\d\d$/.test(tok[after]!) && after > i + 2 && !postal)
        continue; // Calle Real Bodegas 1895
      if (after >= 0) {
        // Calle 8 Tapas Bar：街名词后面紧跟 1–2 位数字、没有 No./# 标记，后面还有没用逗号隔开的大写词，是店名不是地址
        if (after === i + 1 && /^\d{1,2}$/.test(tok[after]!) && !postal) {
          const at = t.indexOf(tok[after]!, t.indexOf(raw));
          const tail = t.slice(at + tok[after]!.length).trim();
          if (
            tail &&
            !/^[,;–—-]|^#|^(?:bis|ter|no|nr|n[º°o])\b\.?|^(?:de|do|da|of|di|del|des|du)\s/i.test(
              tail,
            )
          )
            continue;
        }
        return { ok: true, s: 3 };
      }
      if (postal) return { ok: true, s: 2.8 };
      if (i === 0 && !AMBIG_PRE.has(k)) weakSeen = true;
      continue;
    }
    // 德语单独的 Ring / Damm / Ufer
    if (i >= 1 && DE_WORD_NUM.has(k) && isCap(raw) && findHN(tok, i + 1, i + 2) === i + 1)
      return { ok: true, s: 3 };
    // 荷语单独的街名词：Singel 250 、Laan van Meerdervoort 100（必须有门牌号）
    if (
      i <= 1 &&
      NL_WORD.has(k) &&
      isCap(raw) &&
      !(i === 0 && /^(?:straat|weg|dijk|steeg)$/.test(k)) &&
      findHN(tok, i + 1, i + 4) >= 0
    )
      return { ok: true, s: 2.8 };
    // 德荷复合词
    if (i <= 4 && (COMPOUND.test(k.replace(/\.$/, '')) || DE_WORD.has(k))) {
      if (DE_WORD.has(k) && i === 0) continue; // 「Straße」单独开头不是街名
      const after = findHN(tok, i + 1, i + 3);
      if (after >= 0 && (after === i + 1 || (after === i + 2 && HN_MARK.test(tok[i + 1]!))))
        return { ok: true, s: 3 };
      if (hn0 >= 0 && hn0 < i) return { ok: true, s: 3 };
      if (postal) return { ok: true, s: 2.8 };
      if (i <= 2 && !DE_WORD.has(k)) weakSeen = true;
    }
  }
  return weakSeen ? { ok: false, s: 0, weak: true } : NO;
}

// ---------- 中日韩 ----------
const ADM = /[省市縣县區区鄉乡鎮镇村里郡]/g;
const ROAD = /[路街道段巷弄]|大道|大街|胡同|開發區|开发区|園區|园区/;
const NUMM = /[號号樓楼室座棟栋層层]/;
const CNNUM = /[〇零一二三四五六七八九十百]/;
const FLOOR_CJK =
  /^[0-9A-Za-z\-之]*[樓楼層层室座棟栋Ff]\s*\d*[-之]?\d*[室號号]?$|^\d+[樓楼Ff層层](?:之\d+)?$|^[A-Za-z]?\d*[座棟栋]\d*(?:[樓楼層层]\d*)?$/;
const BLDG_CJK =
  /^[\u4e00-\u9fffA-Za-z0-9 -]{2,12}(?:大廈|大厦|大樓|大楼|廣場|广场|中心|園區|园区|大院)?[A-Za-z0-9 -]*(?:座|棟|栋|層|层|樓|楼|室|F)$/;
const CO_END_CJK =
  /(?:有限公司|股份有限公司|公司|集團|集团|事務所|事务所|工作室|株式会社|有限会社|診所|诊所|醫院|医院|銀行|银行|商行)$/;
function cjkAddress(t: string): number {
  // 返回分数，0 = 不是
  if (t.length < 5 || t.length > 70) return 0;
  const adm = (t.match(ADM) ?? []).length;
  const cls = (adm > 0 ? 1 : 0) + (ROAD.test(t) ? 1 : 0) + (NUMM.test(t) ? 1 : 0);
  const num = /\d/.test(t) || CNNUM.test(t);
  if (KANA.test(t) || HANGUL.test(t)) return cjkJaKo(t);
  if (!CJK.test(t)) return 0;
  if (jobLikeCjk(t) || SLOGAN.test(t)) return 0;
  if (CO_END_CJK.test(t.replace(/[\s.。]+$/, '')) && cls < 3) return 0;
  if (
    /(?:餐厅|餐廳|分店|店|門市|门市|商行|診所|诊所|公司)$/.test(t.replace(/[\s.。]+$/, '')) ||
    /^[路街道巷弄號号]/.test(t)
  )
    return 0;
  if (cls >= 2 && num) return 2 + (cls === 3 ? 0.5 : 0) + 0.5;
  if (adm >= 2 && ROAD.test(t)) return 2.5;
  return 0;
}
const jobLikeCjk = (t: string) => hasJob(t) && !ROAD.test(t);
function cjkJaKo(t: string): number {
  if (KANA.test(t) || /[一-鿿]/.test(t)) {
    // 日语：〒、都道府県市区町村 + 丁目番地号/通り + 数字
    const adm = /[都道府県市区町村郡]/.test(t);
    const road = /丁目|番地|番|号|通り|町/.test(t);
    if ((t.includes('〒') || adm) && (road || /\d/.test(t)) && /\d/.test(t)) return 2.5;
    return 0;
  }
  if (HANGUL.test(t)) {
    // 韩语：시/구/동/로/길 + 数字
    if (/[가-힣]+(?:로|길|대로|동|구|시)\s*\d+/.test(t)) return 2.5;
  }
  return 0;
}

// ---------- 行的整体判断 ----------
interface Line {
  u: Unit;
  text: string; // 去标签、去尾巴后
  labeled: boolean;
  labelOnly: boolean;
  street: Street;
  cjk: number;
  postal: boolean;
  postalCity: boolean;
  bad: boolean; // 联系方式行
}

const CUT_TAIL =
  /\s*(?:[-–—|•·,;/]\s*)?(?:\b(?:tel|tél|tlf|telf|phone|mob|mobile|fax|cel|móvil|portable)\b\.?\s*[:.]?\s*\+?\(?\d|\b(?:e-?mail|www|https?)\b|\bt\s*[:.]\s*\+?\d|\bf\s*[:.]\s*\+?\d|@|[\w-]+\.(?:com|net|org|fr|es|de|it|pt|nl|ch|co\.uk)\b).*$/i;

function prepLine(u: Unit): Line {
  const lab = stripLabel(u.text);
  let text = lab.text;
  // 「Visit us: 15 Rose Lane…」：短前缀 + 冒号，后面是认得出的街道行
  if (!lab.labeled) {
    const pm = text.match(/^([^\d:：]{2,18})[:：]\s*(.{6,})$/);
    if (
      pm &&
      !CONTACT_LABEL.test(pm[1]!.trim() + ':') &&
      (streetLine(pm[2]!).ok || cjkAddress(pm[2]!) > 0)
    )
      text = pm[2]!.trim();
  }
  // 地址行尾巴上的电话/网址
  if (text.length > 8) {
    const m = text.match(CUT_TAIL);
    if (m && m.index !== undefined && m.index >= 6) text = text.slice(0, m.index).trim();
  }
  text = text.replace(/[\s,;|]+$/, '').trim();
  let bad = false;
  if (CONTACT_LABEL.test(u.text.trim()) && !lab.labeled) bad = true;
  if (CONTACT_CJK.test(u.text.trim()) && !lab.labeled) bad = true;
  if (EMAIL.test(text) || URLISH.test(text)) bad = true;
  if (phoneLike(text)) bad = true;
  const sloganHit = SLOGAN.test(text) && !postalIn(text) && !/,/.test(text);
  let street = bad || sloganHit ? NO : streetLine(text);
  // 公司名/店名里带街道词：没有逗号、邮编的不算（Park Avenue Design Studio、3 Avenue Hotel）
  if (
    street.ok &&
    !postalIn(text) &&
    !/,/.test(text) &&
    (hasCompany(text) || LEGAL.test(fold(text)))
  )
    street = NO;
  const cjk = bad ? 0 : cjkAddress(text);
  const pc = !bad && postalCity(text, false);
  return {
    u,
    text,
    labeled: lab.labeled,
    labelOnly: lab.labelOnly,
    street,
    cjk,
    postal: postalIn(text),
    postalCity: pc,
    bad,
  };
}

/** 行 b 紧挨着 a 下面（竖直间隔不大，左/中/右对齐之一）。 */
function below(a: Unit, b: Unit): boolean {
  if (a.page !== b.page) return false;
  const hh = Math.max(a.h, b.h);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (dy <= 0.4 * hh || dy > 2.6 * hh) return false;
  if (Math.min(a.h, b.h) / hh < 0.55) return false;
  return (
    Math.abs(a.x - b.x) < 3 * hh ||
    Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < 3 * hh ||
    Math.abs(a.x + a.w - (b.x + b.w)) < 3 * hh
  );
}

export function addressCandidates(doc: CardDoc): ValueSuggestion[] {
  const units = doc.units
    .filter((u) => u.src === 'cell')
    .slice()
    .sort((a, b) => a.page - b.page || a.y + a.h / 2 - (b.y + b.h / 2));
  const lines = units.map(prepLine);
  const out: { v: string; s: number; relY: number; row: number; used: number[] }[] = [];

  // 单行或多行：以 i 为起点
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]!;
    if (L.bad && !L.labeled) continue;
    let head = L;
    let headIdx = i;
    let score = 0;
    let parts: string[] = [];
    const used: number[] = [i];
    if (L.labelOnly) {
      // 标签单独一行：值取下一行（紧挨着）
      const nx = lines[i + 1];
      if (
        !nx ||
        nx.bad ||
        !below(L.u, nx.u) ||
        !/\p{L}|\d/u.test(nx.text) ||
        (nx.labeled && nx.labelOnly)
      )
        continue;
      if (CJK.test(nx.text) && nx.cjk === 0 && !nx.postalCity) {
        // 中文标签后面的值就算格式不全也认
      }
      head = nx;
      headIdx = i + 1;
      used.push(i + 1);
      score = 4;
      parts = [nx.text];
    } else if (
      !L.street.ok &&
      !L.bad &&
      (L.street.weak ||
        ((BUILDING_LINE.test(fold(L.text)) ||
          /^(?:unit|units|suite|office|room|floor|level)\s+\d/i.test(L.text)) &&
          L.text.length <= 40)) &&
      !(hasCompany(L.text) || hasJob(L.text) || LEGAL.test(fold(L.text))) &&
      lines[i + 1] &&
      !lines[i + 1]!.bad &&
      below(L.u, lines[i + 1]!.u) &&
      postalCity(lines[i + 1]!.text, true)
    ) {
      // 只有街道词没有门牌号，但下一行是邮编城市（The Old Mill, Mill Lane / London…）
      score = 2.4;
      parts = [L.text];
    } else if (L.street.ok) {
      score = L.street.s + (L.labeled ? 1 : 0);
      parts = [L.text];
    } else if (L.cjk > 0) {
      score = L.cjk + (L.labeled ? 1 : 0);
      parts = [L.text];
    } else if (L.labeled && L.text.length >= 3 && /\p{L}|\d/u.test(L.text)) {
      // 有标签、值的格式不认识（Address: Gorriti 5062, Palermo）：认
      score = 3.5;
      parts = [L.text];
    } else continue;

    // 单行的邮编城市已经在街道行里：不再重复
    if (!L.labelOnly && L.street.ok && postalIn(L.text)) score += 0.3;

    // 多行拼接：往下取邮编城市、国家、楼层
    let last = headIdx;
    let sawPostal = postalIn(head.text);
    let sawCountry = false;
    for (let k = last + 1; k < lines.length && parts.length < 4; k++) {
      const N = lines[k]!;
      if (N.bad || !below(lines[last]!.u, N.u)) break;
      if (N.labeled && !N.labelOnly) break; // 另一个有标签的行
      const cjkHere = head.cjk > 0 || CJK.test(head.text);
      let take = false;
      if (cjkHere) {
        // 中文：楼层、室、座
        const nt = N.text.replace(/\s+/g, '');
        take =
          (FLOOR_CJK.test(nt) ||
            (BLDG_CJK.test(N.text.trim()) &&
              /[\d〇零一二三四五六七八九十]/.test(nt) &&
              !CO_END_CJK.test(nt))) &&
          N.text.length <= 16 &&
          !sawCountry;
      } else if (!sawPostal && postalCity(N.text, true)) {
        take = true;
        sawPostal = true;
      } else if (!sawPostal && !sawCountry && unitLine(N.text)) take = true;
      else if (
        !sawPostal &&
        !sawCountry &&
        bridgeCity(N.text) &&
        lines[k + 1] &&
        !lines[k + 1]!.bad &&
        below(N.u, lines[k + 1]!.u) &&
        postalCity(lines[k + 1]!.text, true)
      )
        take = true;
      else if (
        !sawCountry &&
        (sawPostal || parts.length >= 1) &&
        countryLine(N.text) &&
        (sawPostal || parts.length >= 2)
      ) {
        take = true;
        sawCountry = true;
      }
      if (!take) break;
      parts.push(N.text);
      used.push(k);
      last = k;
    }
    // 街道行上面紧挨着的楼层/楼栋行（Building B / Immeuble X）
    if (L.street.ok && i > 0 && !L.labelOnly) {
      const P = lines[i - 1]!;
      if (
        !P.bad &&
        below(P.u, L.u) &&
        unitLine(P.text) &&
        !P.street.ok &&
        P.text.length <= 32 &&
        (BUILDING_LINE.test(fold(P.text)) || /\d|\b[A-Z]\b/.test(P.text))
      ) {
        // 只在上面这行确实像楼栋、楼层时才并（Suite 5 / Building 4）
        parts = [P.text, ...parts];
        used.unshift(i - 1);
        score += 0;
      }
    }
    const v = parts.join('\n');
    out.push({
      v,
      s: score + (parts.length > 1 ? 0.5 : 0),
      relY: head.u.relY,
      row: head.u.row,
      used,
    });
    // 只给整段第一个；街道行单独的版本补在后面
    if (parts.length > 1)
      out.push({
        v: head.text,
        s: score - 0.2,
        relY: head.u.relY,
        row: head.u.row,
        used: [headIdx],
      });
  }

  // 排序、去重（包含关系：短的被长的包含就不再单独给，除非它是被拼出来的第二候选）
  out.sort((a, b) => b.s - a.s || a.row - b.row);
  const res: typeof out = [];
  for (const o of out) {
    const k = squash(o.v);
    if (!k) continue;
    if (res.some((r) => squash(r.v) === k)) continue;
    res.push(o);
    if (res.length >= 3) break;
  }
  return res.map((o) => ({
    value: o.v,
    score: o.s,
    pick: { label: '', relY: Math.round(o.relY * 1000) / 1000 },
  }));
}

// 城市单独一行（London / Milano (MI)）：只在后面紧跟邮编行时才并进地址
function bridgeCity(t: string): boolean {
  const s = t.trim();
  if (s.length < 3 || s.length > 28 || /\d/.test(s) || EMAIL.test(s) || URLISH.test(s))
    return false;
  if (!/^[A-ZÀ-ÖØ-Þ]/.test(s)) return false;
  if (hasJob(s) || hasCompany(s)) return false;
  return s.split(/\s+/).length <= 3;
}
