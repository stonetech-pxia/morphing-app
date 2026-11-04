import type { TextPage } from './rows';
import type { ValueSuggestion } from './rank';
import { firstCount } from './card-names';

// 名片候选规则（研究原型，step4）。输入是识别出的行（带框），输出是网站、姓名、职位、公司的候选。
// 不用后行断言；全部同步；不写数据，不联网。

export interface Unit {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
  row: number; // 全局排号
  relY: number;
  src: 'cell' | 'stack' | 'part';
  /** stack/part 用到的原始格（用于排除重复） */
  from: number[];
  id: number;
}

// ---------- 词表 ----------
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const squash = (s: string) => fold(s).replace(/[^\p{L}\p{N}]/gu, '');

const JOB_LATIN = [
  // en
  'manager',
  'director',
  'engineer',
  'developer',
  'designer',
  'ceo',
  'cto',
  'cfo',
  'coo',
  'cmo',
  'founder',
  'president',
  'vice president',
  'vp',
  'head of',
  'chief',
  'consultant',
  'specialist',
  'analyst',
  'architect',
  'accountant',
  'assistant',
  'coordinator',
  'officer',
  'executive',
  'partner',
  'principal',
  'owner',
  'lawyer',
  'attorney',
  'photographer',
  'artist',
  'writer',
  'editor',
  'teacher',
  'professor',
  'physician',
  'surgeon',
  'dentist',
  'nurse',
  'therapist',
  'supervisor',
  'administrator',
  'representative',
  'advisor',
  'adviser',
  'agent',
  'broker',
  'technician',
  'programmer',
  'copywriter',
  'strategist',
  'planner',
  'recruiter',
  'trainer',
  'coach',
  'stylist',
  'producer',
  'secretary',
  'receptionist',
  'intern',
  'associate',
  'lead',
  'sales',
  'ux',
  'ui',
  'creative',
  'barista',
  'chef',
  'realtor',
  'surveyor',
  'auditor',
  'controller',
  'treasurer',
  'buyer',
  'inspector',
  'scientist',
  'researcher',
  'lecturer',
  'managing',
  'general manager',
  'proprietor',
  'entrepreneur',
  'freelance',
  'detective',
  // fr
  'directeur',
  'directrice',
  'responsable',
  'gerant',
  'gerante',
  'charge de',
  'chargee de',
  'ingenieur',
  'conseiller',
  'conseillere',
  'assistante',
  'fondateur',
  'fondatrice',
  'president',
  'presidente',
  'pdg',
  'dg',
  'avocat',
  'avocate',
  'architecte',
  'comptable',
  'commercial',
  'chef de',
  'delegue',
  'consultante',
  'notaire',
  'medecin',
  'infirmier',
  'infirmiere',
  'secretaire',
  'redacteur',
  'photographe',
  'dessinateur',
  'graphiste',
  'formateur',
  'courtier',
  'proprietaire',
  'associe',
  'associee',
  'gestionnaire',
  'technicien',
  'technicienne',
  // es / pt
  'gerente',
  'ingeniero',
  'ingeniera',
  'consultor',
  'consultora',
  'disenador',
  'disenadora',
  'fundador',
  'fundadora',
  'abogado',
  'abogada',
  'arquitecto',
  'arquitecta',
  'jefe',
  'jefa',
  'coordinador',
  'coordinadora',
  'administrador',
  'administradora',
  'contador',
  'contadora',
  'asesor',
  'asesora',
  'propietario',
  'propietaria',
  'socio',
  'socia',
  'medico',
  'profesor',
  'profesora',
  'representante',
  'vendedor',
  'vendedora',
  'tecnico',
  'tecnica',
  'secretaria',
  'diretor',
  'diretora',
  'engenheiro',
  'engenheira',
  'advogado',
  'advogada',
  'arquiteto',
  'arquiteta',
  'fotografo',
  'fotografa',
  'sócio',
  'proprietário',
  // de
  'geschaftsfuhrer',
  'geschaftsfuhrerin',
  'leiter',
  'leiterin',
  'inhaber',
  'inhaberin',
  'berater',
  'beraterin',
  'ingenieur',
  'vorstand',
  'rechtsanwalt',
  'rechtsanwaltin',
  'architektin',
  'architekt',
  'steuerberater',
  'projektleiter',
  'vertriebsleiter',
  'gesellschafter',
  'fotograf',
  'fotografin',
  'sachverstandiger',
  'meister',
  'abteilungsleiter',
  'prokurist',
  // it
  'direttore',
  'direttrice',
  'amministratore',
  'amministratrice',
  'ingegnere',
  'avvocato',
  'responsabile',
  'consulente',
  'commercialista',
  'titolare',
  'geometra',
  'fondatore',
  'fondatrice',
  'agente',
  'segretaria',
  'architetto',
  'fotografo',
  'presidente',
  'progettista',
  'sviluppatore',
  'sviluppatrice',
  'programmatore',
  'grafico',
  'gestor',
  'gestora',
  'analista',
  'ejecutivo',
  'ejecutiva',
  'desarrollador',
  'desarrolladora',
  'encargado',
  'encargada',
  'desenvolvedor',
  'desenvolvedora',
  'analyste',
  'developpeur',
  'developpeuse',
];
const JOB_CJK = [
  '经理',
  '經理',
  '总监',
  '總監',
  '董事',
  '总裁',
  '總裁',
  '副总',
  '副總',
  '主任',
  '主管',
  '工程师',
  '工程師',
  '设计师',
  '設計師',
  '顾问',
  '顧問',
  '律师',
  '律師',
  '医师',
  '醫師',
  '会计',
  '會計',
  '教授',
  '老师',
  '老師',
  '创始人',
  '創辦人',
  '创办人',
  '合伙人',
  '合夥人',
  '负责人',
  '負責人',
  '专员',
  '專員',
  '助理',
  '秘书',
  '秘書',
  '业务',
  '業務',
  '代表',
  '厂长',
  '廠長',
  '店长',
  '店長',
  '技师',
  '技師',
  '摄影师',
  '攝影師',
  '建筑师',
  '建築師',
  '总工',
  '部长',
  '部長',
  '科长',
  '课长',
  '課長',
  '主编',
  '编辑',
  '編輯',
  '院长',
  '院長',
  '校长',
  '校長',
  '所长',
  '所長',
  '局长',
  '局長',
  '处长',
  '處長',
  '理事',
  '经纪人',
  '經紀人',
  '会长',
  '會長',
  '讲师',
  '講師',
  '教练',
  '教練',
  '总经理',
  '總經理',
  '执行',
  '執行',
  '研究员',
  '研究員',
  '分析师',
  '分析師',
  '营业',
  '營業',
  '课長',
  '社長',
  '部長',
  '取締役',
  '代表取締役',
  '室長',
];
const jobCjk = (t: string) => JOB_CJK.some((w) => t.includes(w));
const JOB_RE = new RegExp(
  `(^|[^a-z0-9])(?:${[...new Set(JOB_LATIN)]
    .map((w) => fold(w))
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(?![a-z])`,
);
// 词表里短的缩写（ux、ui、vp、dg、lead）只当整词；其余的前缀匹配（directeur → directrice 各自在表里）。
export const hasJob = (t: string) => {
  const f = fold(t);
  return JOB_RE.test(f) || jobCjk(t);
};

const COMPANY_WORD = new RegExp(
  `(^|[^a-z0-9])(?:ltd|limited|llc|llp|inc|incorporated|corp|corporation|co|company|gmbh|ag|kg|ug|sarl|sas|sasu|sa|sl|srl|spa|bv|nv|oy|pty|plc|group|holding|holdings|partners|associates|and sons|studio|studios|agency|consulting|consultants|solutions|services|technologies|technology|systems|industries|international|enterprises|laboratories|labs|bank|hotel|restaurant|cafe|bakery|clinic|dental|hospital|school|university|institute|foundation|association|design|designs|photography|productions|media|marketing|advertising|logistics|construction|engineering|architects|architecture|realty|properties|insurance|capital|ventures|trading|import|export|cabinet|etude|societe|entreprise|agence|atelier|empresa|despacho|asesores|estudio|consultoria|unternehmensberatung|werkstatt|buro|studio legale)(?![a-z0-9])`,
);
const COMPANY_CJK = [
  '有限公司',
  '股份有限公司',
  '公司',
  '集团',
  '集團',
  '事务所',
  '事務所',
  '工作室',
  '工作坊',
  '工程',
  '科技',
  '企业',
  '企業',
  '商行',
  '商店',
  '中心',
  '研究所',
  '研究院',
  '医院',
  '醫院',
  '診所',
  '诊所',
  '学校',
  '學校',
  '大学',
  '大學',
  '银行',
  '銀行',
  '酒店',
  '饭店',
  '飯店',
  '餐厅',
  '餐廳',
  '设计',
  '設計',
  '傢俱',
  '家具',
  '清潔',
  '清洁',
  '機械',
  '机械',
  '株式会社',
  '有限会社',
  '合同会社',
  '事務所',
];
export const hasCompany = (t: string) =>
  COMPANY_WORD.test(fold(t)) || COMPANY_CJK.some((w) => t.includes(w));
const COMPANY_SUFFIX_STRICT = new RegExp(
  `(^|[^a-z0-9])(?:ltd|limited|llc|llp|inc|incorporated|corp|corporation|gmbh|ag|kg|sarl|sas|sasu|s\\.a|s\\.l|srl|spa|bv|nv|pty|plc|co\\.?,? ?ltd)\\.?\\s*$`,
);
const SUFFIX_CJK = [
  '有限公司',
  '股份有限公司',
  '公司',
  '株式会社',
  '有限会社',
  '合同会社',
  '集团',
  '集團',
  '事务所',
  '事務所',
  '工作室',
];
export const hasSuffix = (t: string) =>
  COMPANY_SUFFIX_STRICT.test(
    fold(t)
      .replace(/[,.]+$/, '')
      .trim(),
  ) ||
  SUFFIX_CJK.some((w) => t.includes(w)) ||
  /(^|[^a-z0-9])(?:ltd|llc|inc|gmbh|sarl|s\.?a\.?s?|s\.?l\.?|co\.,? ?ltd)\b/.test(fold(t));

const ADDRESS_WORD = new RegExp(
  `(^|[^a-z0-9])(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|drive|suite|floor|building|bldg|city|state|zip|rue|avenue|boulevard|bd|place|chemin|impasse|allee|calle|avenida|plaza|paseo|carrer|via|viale|piazza|corso|strasse|str|platz|weg|allee|rua|travessa|largo)(?![a-z])`,
);
const ADDRESS_CJK = /[路街巷弄號号樓楼室區区市縣县鄉鄉村道段]/;

const SOCIAL =
  /(^|[^a-z0-9])(facebook|fb|twitter|instagram|linkedin|youtube|weibo|wechat|line|t|wa|tiktok|skype|pinterest|behance|dribbble|xing|github|whatsapp|snapchat|telegram)\./;

const TLD =
  'com|org|net|edu|gov|info|biz|io|co|app|dev|ai|me|tv|xyz|online|site|shop|store|studio|design|tech|agency|cloud|email|eu|fr|es|de|it|pt|uk|ch|be|nl|at|ca|us|au|nz|ie|se|no|dk|fi|pl|cz|sk|hu|ro|bg|gr|tr|ru|ua|mx|ar|br|cl|pe|co|ve|uy|za|eg|ma|tn|il|ae|sa|in|pk|bd|cn|hk|tw|jp|kr|sg|my|th|vn|id|ph|lu|lt|lv|ee|si|hr|rs|is|cat|paris|london|berlin|bio|club|legal|law|photo|photography|art|coffee|consulting|group|company|ltd|inc|studio';
const SITE_RE = new RegExp(
  `(^|[^\\w@.\\-/])((?:https?://)?(?:www\\.)?[a-z0-9][a-z0-9\\-]*(?:\\.[a-z0-9\\-]+)*\\.(?:${TLD})(?:\\.[a-z]{2})?(?:/[^\\s,;]*)?)(?![\\w@\\-])`,
  'gi',
);
const GENERIC_MAIL =
  /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|aol|qq|163|126|sina|sohu|foxmail|proton|protonmail|gmx|web|t-online|orange|free|wanadoo|laposte|sfr|neuf|libero|virgilio|tiscali|hinet|naver|daum|hanmail|kakao|yandex|mail|rambler|bluewin|terra|uol|bol|ig|telefonica|movistar|msa|seed|so-net|ezweb|docomo|softbank|nifty|biglobe|ocn|yahoo\.co|hotmail\.co)$/;

// ---------- 分析 ----------
export interface CardDoc {
  units: Unit[];
  emails: string[];
  sites: { value: string; social: boolean; unit: number }[];
  medianH: number;
  maxH: number;
  nRows: number;
}

let uid = 0;
export function analyzeCard(pages: readonly TextPage[]): CardDoc {
  const units: Unit[] = [];
  let rowBase = 0;
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi]!;
    const H = page.height || 1;
    // 拍出来的名片常是歪的，排的合并会把不相干的字接在一起：直接用识别出的行，按竖直中心排序。
    const ls = page.lines
      .filter((l) => l.text.trim())
      .map((l) => ({ ...l, cy: l.y + l.height / 2 }))
      .sort((a, b) => a.cy - b.cy);
    ls.forEach((l, ri) =>
      units.push({
        text: l.text.trim(),
        x: l.x,
        y: l.y,
        w: l.width,
        h: l.height,
        page: pi,
        row: rowBase + ri,
        relY: l.cy / H,
        src: 'cell',
        from: [],
        id: uid++,
      }),
    );
    rowBase += ls.length;
  }
  const cells = [...units];
  const nRows = rowBase;
  // 叠起来的两行（姓和名、公司名分两行）：下面一行左对齐或居中对齐、字高相近、间隔小。
  if (cells.length <= 150) {
    for (const a of cells) {
      for (const b of cells) {
        if (b.page !== a.page || b === a) continue;
        const hh = Math.max(a.h, b.h);
        const dy = b.y + b.h / 2 - (a.y + a.h / 2);
        const ratio = Math.min(a.h, b.h) / hh;
        const alignL = Math.abs(a.x - b.x) < 1.2 * hh;
        const alignC = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < 1.2 * hh;
        if (dy <= 0.4 * hh || dy > 1.5 * hh || ratio < 0.6 || !(alignL || alignC)) continue;
        if (a.text.split(/\s+/).length > 3 || b.text.split(/\s+/).length > 3) continue;
        units.push({
          text: `${a.text} ${b.text}`,
          x: Math.min(a.x, b.x),
          y: a.y,
          w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
          h: Math.max(a.h, b.h),
          page: a.page,
          row: a.row,
          relY: a.relY,
          src: 'stack',
          from: [a.id, b.id],
          id: uid++,
        });
      }
    }
  }
  // 一格里用分隔符拼了几样（姓名, 职位 | 公司）：拆成各段。
  for (const c of cells) {
    const parts = c.text
      .split(/\s*[|｜·•,，;；/／]\s*|\s+[-–—]\s+/)
      .filter((p) => p.trim().length > 0);
    if (parts.length > 1)
      for (const p of parts)
        units.push({ ...c, text: p.trim(), src: 'part', from: [c.id], id: uid++ });
  }
  const hs = cells.map((c) => c.h).sort((a, b) => a - b);
  const medianH = hs[Math.floor(hs.length / 2)] ?? 1;
  const maxH = hs[hs.length - 1] ?? 1;
  const emails: string[] = [];
  const sites: CardDoc['sites'] = [];
  for (const c of cells) {
    for (const m of c.text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g))
      emails.push(m[0].toLowerCase());
    for (const m of c.text.matchAll(SITE_RE)) {
      let v = m[2]!.replace(/[.,;:)\]}]+$/, '');
      v = v.replace(/^(https?:\/\/)/i, (x) => x.toLowerCase());
      sites.push({ value: v, social: SOCIAL.test(fold(v)), unit: c.id });
    }
  }
  return { units, emails, sites, medianH, maxH, nRows };
}

/** b 紧挨着 a（上或下一行，左对齐或居中对齐）。 */
export function adjacent(a: Unit, b: Unit): boolean {
  if (a.page !== b.page || a === b) return false;
  const hh = Math.max(a.h, b.h);
  const dy = Math.abs(b.y + b.h / 2 - (a.y + a.h / 2));
  if (dy <= 0.4 * hh || dy > 2.2 * hh) return false;
  return Math.abs(a.x - b.x) < 1.5 * hh || Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < 1.5 * hh;
}

const vs = (value: string, score: number, relY: number): ValueSuggestion => ({
  value,
  score,
  pick: { label: '', relY: Math.round(relY * 1000) / 1000 },
});

// ---------- 网站 ----------
export function websiteCandidates(doc: CardDoc): ValueSuggestion[] {
  const out: { v: string; s: number; relY: number }[] = [];
  const seen = new Set<string>();
  const key = (v: string) =>
    fold(v)
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  for (const s of doc.sites) {
    const k = key(s.value);
    if (seen.has(k)) continue;
    seen.add(k);
    const u = doc.units.find((x) => x.id === s.unit)!;
    let sc = 2;
    if (/^(https?:\/\/|www\.)/i.test(s.value)) sc += 1;
    if (!/\//.test(s.value.replace(/^https?:\/\//i, ''))) sc += 0.3;
    // 标签：同一格里值前面有 web/site/url/网址 之类的字
    if (
      /(web|site|url|www|网站|網站|网址|網址|官网|sitio|página)/i.test(u.text.replace(s.value, ''))
    )
      sc += 0.5;
    if (s.social) {
      sc -= 1.5;
    }
    out.push({ v: s.value, s: sc, relY: u.relY });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, 3).map((o) => vs(o.v, o.s, o.relY));
}

// ---------- 姓名 ----------
const HONOR = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'prof',
  'sir',
  'mme',
  'mlle',
  'm',
  'sr',
  'sra',
  'srta',
  'don',
  'dona',
  'herr',
  'frau',
  'dott',
  'ing',
  'lic',
  'arq',
  'eng',
  'me',
  'pr',
  'dipl',
  'mag',
]);
const PARTICLE = new Set([
  'de',
  'del',
  'della',
  'di',
  'da',
  'do',
  'dos',
  'das',
  'du',
  'la',
  'le',
  'van',
  'von',
  'der',
  'den',
  'ten',
  'ter',
  'bin',
  'al',
  'el',
  'y',
  'e',
  'st',
  'mc',
  'mac',
]);
const SUR_CJK =
  '王李张張刘劉陈陳杨楊黄黃赵趙吴吳周徐孙孫马馬朱胡郭何高林罗羅郑鄭梁谢謝宋唐许許韩韓冯馮邓鄧曹彭曾萧蕭田董袁潘于蒋蔣蔡余杜叶葉程苏蘇魏吕呂丁任沈姚卢盧姜崔钟鍾谭譚陆陸汪范金石廖贾賈夏韦韋付方白邹鄒孟熊秦邱江尹薛阎閻段雷侯龙龍史陶黎贺賀顾顧毛郝龚龔邵万萬钱錢严嚴武戴莫孔向汤湯洪温溫康施文牛樊葛邢安齐齊易乔喬伍庞龐颜顏倪庄莊聂聶章鲁魯岳翟殷詹申欧歐耿关關兰蘭焦俞左柳甘祝包宁寧尚符舒阮柯纪紀梅童凌毕畢单單季裴霍涂成苗谷盛曲翁冉骆駱蓝藍路游辛靳管柴蒙鲍鮑华華喻祁蒲房滕屈饶饒解牟艾尤阳陽时時穆农農司卓古吉缪繆简簡车車项項连連扶筱骨';
const SUR_COMPOUND = [
  '欧阳',
  '歐陽',
  '司马',
  '司馬',
  '上官',
  '诸葛',
  '諸葛',
  '东方',
  '東方',
  '皇甫',
  '尉迟',
  '公孙',
  '公孫',
  '慕容',
  '令狐',
  '夏侯',
  '司徒',
  '端木',
  '长孙',
  '長孫',
  '宇文',
  '轩辕',
  '轅轅',
  '淳于',
  '单于',
];
const surnameCjk = (t: string) =>
  SUR_COMPOUND.some((c) => t.startsWith(c)) || SUR_CJK.includes(t[0]!);

const TOK = /^[\p{L}][\p{L}'’.\-]*$/u;
const isUpperStart = (w: string) => /^[\p{Lu}]/u.test(w);

interface NameHit {
  value: string;
  fhit: number;
  echo: number;
  cjk: boolean;
}

function localTokens(emails: string[]): { locals: string[]; toks: Set<string> } {
  const locals: string[] = [];
  const toks = new Set<string>();
  for (const e of emails) {
    const l = fold(e.split('@')[0]!).replace(/[^a-z0-9._+-]/g, '');
    locals.push(l.replace(/[._+-]/g, ''));
    for (const t of l.split(/[._+-]+/)) if (t) toks.add(t);
  }
  return { locals, toks };
}

export function nameOf(
  text: string,
  doc: CardDoc,
  lt: ReturnType<typeof localTokens>,
): NameHit | null {
  let t = text.trim().replace(/\s+/g, ' ');
  if (!t || t.length > 40) return null;
  const compact = t.replace(/[\s　]/g, '');
  if (/^[㐀-鿿]{2,4}$/.test(compact)) {
    if (!surnameCjk(compact)) return null;
    if (compact.length === 4 && !SUR_COMPOUND.some((c) => compact.startsWith(c))) return null;
    if (hasCompany(compact) || jobCjk(compact) || ADDRESS_CJK.test(compact)) return null;
    return { value: compact, fhit: 0, echo: 0, cjk: true };
  }
  if (/[\d@:/&_#%+=<>()[\]{}]/.test(t) || /[㐀-鿿가-힯぀-ヿ]/.test(t)) return null;
  let words = t.split(' ').filter(Boolean);
  // 前面的称呼去掉（Dr. Mr. M.）
  while (words.length > 2 && HONOR.has(fold(words[0]!).replace(/\.$/, ''))) words.shift();
  // 末尾的 Jr. / PhD
  words = words.filter((w, i) => !(i > 0 && /^(jr|sr|ii|iii|phd|mba|cpa|md)\.?,?$/i.test(w)));
  if (words.length < 2 || words.length > 4) return null;
  const core = words.filter((w) => !PARTICLE.has(fold(w)));
  if (core.length < 2) return null;
  for (const w of words) {
    if (!TOK.test(w)) return null;
    if (!PARTICLE.has(fold(w)) && !isUpperStart(w)) return null;
  }
  // 单字母缩写最多一个
  if (core.filter((w) => w.replace(/\./g, '').length === 1).length > 1) return null;
  const joined = words.join(' ');
  if (hasJob(joined) || hasCompany(joined) || ADDRESS_WORD.test(fold(joined))) return null;
  const f = core.map((w) => fold(w).replace(/[.'’]/g, '').replace(/-.*$/, ''));
  const firstTok = f[0]!;
  const lastTok = f[f.length - 1]!;
  const fc = Math.max(
    firstCount(firstTok),
    firstCount(lastTok),
    ...(f.length > 2 ? f.slice(1, -1).map((x) => firstCount(x)) : [0]),
  );
  // 邮箱前缀呼应：名/姓的前三个字母以上出现在邮箱的段里，或者「首字母 + 姓」。
  let echo = 0;
  for (const w of f) {
    if (w.length >= 3 && (lt.toks.has(w) || lt.locals.some((l) => l.includes(w)))) echo++;
  }
  if (echo < 2 && f.length >= 2) {
    const ini = firstTok[0]! + lastTok;
    const ini2 = lastTok + firstTok[0]!;
    if (lastTok.length >= 3 && lt.locals.some((l) => l === ini || l === ini2 || l.startsWith(ini)))
      echo = 2;
  }
  return { value: joined, fhit: fc, echo, cjk: false };
}

export function nameCandidates(doc: CardDoc): ValueSuggestion[] {
  const lt = localTokens(doc.emails);
  const MINF = 100;
  const cands: { v: string; s: number; relY: number; row: number }[] = [];
  const seen = new Set<string>();
  for (const u of doc.units) {
    if (u.src === 'part') continue;
    const h = nameOf(u.text, doc, lt);
    if (!h) continue;
    if (!h.cjk && h.fhit < MINF && h.echo < 2) continue;
    let sc =
      1 +
      (h.fhit >= 1000 ? 2 : h.fhit >= MINF ? 1.5 : 0) +
      (h.echo >= 2 ? 3 : h.echo === 1 ? 0.5 : 0);
    if (h.cjk) sc += 2;
    if (u.h >= doc.medianH) sc += 0.5;
    if (u.h >= 1.4 * doc.medianH) sc += 0.3;
    sc += Math.max(0, 1 - u.row / 8) * 0.5;
    const k = squash(h.value);
    if (seen.has(k)) continue;
    seen.add(k);
    cands.push({ v: h.value, s: sc, relY: u.relY, row: u.row });
  }
  cands.sort((a, b) => b.s - a.s || a.row - b.row);
  return cands.slice(0, 3).map((c) => vs(c.v, c.s, c.relY));
}

// ---------- 职位 ----------
const GERMAN_END =
  /(leitung|leiter|leiterin|beratung|berater|beraterin|entwickler|entwicklerin|designer|designerin|grafikdesign|grafikdesignerin|sachbearbeiter|referent|buchhaltung|vertrieb)$/;
const hasJobDe = (t: string) =>
  fold(t)
    .split(/[^a-z]+/)
    .some((w) => w.length >= 8 && GERMAN_END.test(w));
export function titleCandidates(doc: CardDoc): ValueSuggestion[] {
  const lt = localTokens(doc.emails);
  const isName = (u: Unit) => {
    const n = nameOf(u.text, doc, lt);
    return !!n && (n.fhit >= 100 || n.echo >= 2 || n.cjk);
  };
  const names = doc.units.filter(isName);
  const cands: { v: string; s: number; relY: number; row: number }[] = [];
  const seen = new Set<string>();
  for (const u of doc.units) {
    if (u.src !== 'cell') continue;
    const t = u.text.trim();
    if (t.length < 2 || t.length > 50) continue;
    if (/[@]|https?:|www\./i.test(t) || /\d{4,}/.test(t)) continue;
    if (!hasJob(t) && !hasJobDe(t)) continue;
    // 公司名里带职位词的（Design Studio、Consulting）：有公司后缀的整行不当职位
    if (hasSuffix(t)) continue;
    if (ADDRESS_WORD.test(fold(t)) && !/(manager|director)/.test(fold(t))) continue;
    const words = t.split(/\s+/).length;
    if (!/[\u3400-\u9fff]/.test(t) && words > 7) continue;
    let sc = 1;
    // 紧挨姓名
    const near = names.some((n) => n.id !== u.id && !u.from.includes(n.id) && adjacent(n, u));
    if (near) sc += 2;
    const k = squash(t);
    if (seen.has(k)) continue;
    seen.add(k);
    cands.push({
      v: t.replace(/^[\s:：|·•-]+|[\s:：|·•,-]+$/g, ''),
      s: sc,
      relY: u.relY,
      row: u.row,
    });
  }
  cands.sort((a, b) => b.s - a.s || a.row - b.row);
  return cands
    .filter((c) => c.s >= 0.5)
    .slice(0, 3)
    .map((c) => vs(c.v, c.s, c.relY));
}

// ---------- 公司 ----------
function domainLabels(doc: CardDoc): string[] {
  const out: string[] = [];
  const add = (host: string) => {
    const parts = fold(host).split('.').filter(Boolean);
    if (parts.length < 2) return;
    // 去掉常见的二级后缀
    let i = parts.length - 2;
    if (['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'].includes(parts[i]!) && parts.length >= 3)
      i--;
    const lab = parts[i]!;
    if (lab.length >= 3 && !GENERIC_MAIL.test(lab)) out.push(lab.replace(/[^a-z0-9]/g, ''));
  };
  for (const e of doc.emails) add(e.split('@')[1] ?? '');
  for (const s of doc.sites)
    add(
      s.value
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0]!,
    );
  return [...new Set(out)];
}

export function companyCandidates(doc: CardDoc): ValueSuggestion[] {
  const labels = domainLabels(doc);
  const lt = localTokens(doc.emails);
  const cellUnits = doc.units.filter((u) => u.src === 'cell');
  const count = new Map<string, number>();
  for (const u of cellUnits) {
    const k = squash(u.text);
    if (k.length >= 3) count.set(k, (count.get(k) ?? 0) + 1);
  }
  const cands: { v: string; s: number; relY: number; row: number; why: string }[] = [];
  const seen = new Set<string>();
  const sortedH = [...cellUnits].map((u) => u.h).sort((a, b) => b - a);
  for (const u of doc.units) {
    if (u.src === 'part') continue;
    // 叠起来的两行里有职位行（Sales Manager + Northwind Ltd）：不是一个公司名。
    if (
      u.src === 'stack' &&
      u.from.some((id) => {
        const p = doc.units.find((o) => o.id === id);
        return p !== undefined && hasJob(p.text) && !hasSuffix(p.text);
      })
    )
      continue;
    const t = u.text.trim().replace(/^[\s:：|·•=*-]+|[\s:：|·•,*-]+$/g, '');
    if (t.length < 2 || t.length > 40 || !/\p{L}/u.test(t)) continue;
    if (
      /@|https?:|www\./i.test(t) ||
      /(^|[^a-z])(tel|fax|mob|mobile|phone|email|e-mail|web)[\s.:]/i.test(t)
    )
      continue;
    const dig = (t.match(/\d/g) ?? []).length;
    if (dig > 0.25 * t.length) continue;
    if (SITE_RE.test(t)) {
      SITE_RE.lastIndex = 0;
      continue;
    }
    SITE_RE.lastIndex = 0;
    if (ADDRESS_WORD.test(fold(t)) && !hasSuffix(t)) continue;
    if (ADDRESS_CJK.test(t) && /[\d0-9]/.test(t)) continue;
    const nh = nameOf(t, doc, lt);
    if (nh && (nh.fhit >= 100 || nh.echo >= 2 || nh.cjk) && !hasSuffix(t)) continue;
    if (hasJob(t) && !hasSuffix(t)) continue;
    const sq = squash(t);
    let sc = 0;
    let why = '';
    const suf = hasSuffix(t);
    if (suf) {
      sc += 2.5;
      why += 'S';
    }
    // 邮箱/网站域名呼应
    let echoV = 0;
    for (const l of labels) {
      if (Math.min(l.length, sq.length) < 4) continue;
      if (l === sq) echoV = Math.max(echoV, 3.5);
      else if (l.includes(sq)) echoV = Math.max(echoV, 1.5 + (1.5 * sq.length) / l.length);
      else if (sq.includes(l)) echoV = Math.max(echoV, 1.5 + (1.5 * l.length) / sq.length);
    }
    if (echoV > 0) {
      sc += echoV;
      why += 'E';
    }
    if ((count.get(sq) ?? 0) >= 2) {
      sc += 1;
      why += 'R';
    }
    if (u.h >= 1.3 * doc.medianH && u.h >= (sortedH[Math.min(2, sortedH.length - 1)] ?? 0)) {
      sc += 0.7;
      why += 'H';
    }
    if (u.relY < 0.35) sc += 0.3;
    if (hasCompany(t) && !suf) {
      sc += 0.8;
      why += 'C';
    }
    if (sc <= 0) continue;
    const k = sq;
    if (seen.has(k)) continue;
    seen.add(k);
    cands.push({ v: t, s: sc, relY: u.relY, row: u.row, why });
  }
  cands.sort((a, b) => b.s - a.s || a.row - b.row);
  const gate = 2;
  return cands
    .filter((c) => c.s >= gate)
    .slice(0, 3)
    .map((c) => vs(c.v, c.s, c.relY));
}

// ---------- 邮箱：识别把「@」两边拆开、加了空格、拆成上下两行的写法 ----------
export function looseEmails(doc: CardDoc): ValueSuggestion[] {
  const out: { v: string; relY: number }[] = [];
  const add = (v: string, relY: number) => {
    const e = v
      .replace(/\s+/g, '')
      .toLowerCase()
      .replace(/[.,;:]+$/, '');
    if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}$/.test(e) && !out.some((o) => o.v === e))
      out.push({ v: e, relY });
  };
  const cells = doc.units.filter((u) => u.src === 'cell');
  for (const u of cells) {
    for (const m of u.text.matchAll(/([\w.+-]+)\s*@\s*([\w-]+(?:\s*\.\s*[\w-]+)+)/g))
      add(`${m[1]}@${m[2]}`, u.relY);
    const lead = u.text.match(/^\s*@\s*([\w-]+(?:\.[\w-]+)+)/);
    if (!lead) continue;
    let best: { v: string; d: number } | null = null;
    for (const a of cells) {
      if (a === u || a.page !== u.page || /@/.test(a.text)) continue;
      const tail = a.text.match(/([\w.+-]+)\s*$/);
      if (!tail || (tail[1]!.match(/[A-Za-z]/g) ?? []).length < 3) continue;
      const hh = Math.max(a.h, u.h);
      const dyc = u.y + u.h / 2 - (a.y + a.h / 2);
      const sameLine = Math.abs(dyc) < 0.6 * hh && u.x - (a.x + a.w) < 1.5 * hh && u.x >= a.x;
      const stacked = dyc > 0.4 * hh && dyc < 1.6 * hh && Math.abs(a.x - u.x) < 1.0 * hh;
      if (!sameLine && !stacked) continue;
      const d = Math.abs(dyc) + Math.abs(u.x - (a.x + a.w));
      if (!best || d < best.d) best = { v: `${tail[1]}@${lead[1]}`, d };
    }
    if (best) add(best.v, u.relY);
  }
  return out.slice(0, 3).map((o) => vs(o.v, 1.3, o.relY));
}

// ---------- 地址：没有标签时按格式认（门牌、路名词；中文的市区路段号） ----------
const ADM = /[市縣县區区鄉鎮镇]/;
const ROAD = /[路街道段巷弄]/;
const NUMM = /[號号樓楼室]/;
export function addressByFormat(doc: CardDoc): ValueSuggestion[] {
  const out: { v: string; s: number; relY: number; row: number }[] = [];
  const seen = new Set<string>();
  for (const u of doc.units) {
    if (u.src !== 'cell') continue;
    const t = u.text
      .trim()
      .replace(/^[\s:：|·•-]+/, '')
      .replace(/^[^\d:：]{1,16}[:：]\s*/, '');
    if (t.length < 6 || t.length > 70 || /@|https?:|www\./i.test(t)) continue;
    let sc = 0;
    if (/[\u3400-\u9fff]/.test(t)) {
      const cls = (ADM.test(t) ? 1 : 0) + (ROAD.test(t) ? 1 : 0) + (NUMM.test(t) ? 1 : 0);
      if (cls >= 2 && /\d/.test(t) && !jobCjk(t)) sc = 2 + (cls === 3 ? 0.5 : 0);
    } else if (/\d/.test(t) && ADDRESS_WORD.test(fold(t)) && !/^[\s\d()+.\-]+$/.test(t)) {
      // 门牌号 + 街名词；整行不是电话
      const digits = (t.match(/\d/g) ?? []).length;
      if (digits <= 0.5 * t.length && /[a-z]{3,}/i.test(t)) sc = 2;
    }
    if (sc === 0) continue;
    const k = squash(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ v: t, s: sc, relY: u.relY, row: u.row });
  }
  out.sort((a, b) => b.s - a.s || a.row - b.row);
  return out.slice(0, 3).map((o) => vs(o.v, o.s, o.relY));
}

/** 这份文字像不像名片：行不多、有联系方式、没有明细和合计这类单据字样。 */
export function cardLike(doc: CardDoc, strict = false): boolean {
  const cells = doc.units.filter((u) => u.src === 'cell');
  if (cells.length === 0 || cells.length > 60) return false;
  if (strict) {
    // 公司栏原来就有（小票/发票的店名、开票方）打分，名片规则要接手就得先有联系方式。
    const phone = cells.some((u) => /(^|[^\d])\+?\(?\d[\d\s\-().]{6,}\d/.test(u.text));
    if (doc.emails.length === 0 && doc.sites.length === 0 && !phone) return false;
    if (cells.length > 40) return false;
  }
  const money = cells.filter((u) =>
    /(^|\s)\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(\s|$)/.test(u.text),
  ).length;
  if (money > 1) return false;
  if (
    money >= 1 &&
    cells.some((u) =>
      /\b(total|amount|tax|vat|cash|change|balance|tva|montant|importe|totale|betrag)\b|合计|合計|金额|金額|总计|總計|税/i.test(
        u.text,
      ),
    )
  )
    return false;
  // 有日期又有金额的是单据
  if (money >= 1 && cells.some((u) => /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/.test(u.text)))
    return false;
  return !cells.some((u) =>
    /\b(subtotal|total due|grand total|invoice|receipt|qty|quantity)\b|合计|合計|小计|小計|发票|發票|收据|收據/i.test(
      u.text,
    ),
  );
}

export function cardCandidates(
  concept: 'name' | 'jobTitle' | 'website' | 'company',
  pages: readonly TextPage[],
): ValueSuggestion[] {
  const doc = analyzeCard(pages);
  switch (concept) {
    case 'website':
      return websiteCandidates(doc);
    case 'name':
      return nameCandidates(doc);
    case 'jobTitle':
      return titleCandidates(doc);
    case 'company':
      return companyCandidates(doc);
  }
}
