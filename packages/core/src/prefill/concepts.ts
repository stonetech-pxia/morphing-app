import type { Field } from '../schema';
import { norm } from './similarity';

// 新记录表单的候选值（D-388）：字段是「什么」的小词典。字段名（中英法任一种）对上一个概念时，
// 用这个概念三种语言的关键词和排除词给单据上的标签打分（测量里三语同义词和同语言一样好，
// side-session-notes/prefill-ranking）；对不上时关键词只有字段自己的名字。不用向量模型。

export type ConceptId =
  | 'amount'
  | 'tax'
  | 'issueDate'
  | 'dueDate'
  | 'signDate'
  | 'merchant'
  | 'company'
  | 'name'
  | 'number'
  | 'phone'
  | 'email'
  | 'address'
  | 'origin'
  | 'destination'
  | 'title'
  | 'purpose'
  | 'category';

/** 候选值的种类：字段要哪一种值。 */
export type ValueKind = 'money' | 'date' | 'phone' | 'email' | 'id' | 'text';

export interface Concept {
  /** 字段名能对上的写法（三种语言）。 */
  names: readonly string[];
  /** 单据上的标签像这些词时加分。 */
  keywords: readonly string[];
  /** 单据上的标签像这些词时减分（覆盖 ≥ 0.75 才算）。 */
  exclude: readonly string[];
  /** 文字字段要的值；不写时按字段类型。 */
  kind?: ValueKind;
  /** 没有标签时，第一页最上面三排的字可以当候选（商家、公司、标题，不含姓名）。 */
  position?: boolean;
}

// 关键词和排除词照搬测量用的 config.json（金额、税额、日期、商家、公司、姓名、电话、邮箱、单号、
// 出发地、目的地、分类），到期日、签订日期、地址、标题、事由是这次加的。
export const CONCEPTS: Record<ConceptId, Concept> = {
  amount: {
    names: [
      'amount',
      'total',
      'price',
      'cost',
      '金额',
      '合计',
      '总额',
      '实付',
      '价格',
      '费用',
      'montant',
      'prix',
      'coût',
    ],
    keywords: [
      'amount',
      'total',
      'grand total',
      'total paid',
      'amount paid',
      'paid',
      'net total',
      'total due',
      'amount due',
      'balance due',
      'payable',
      '金额',
      '合计',
      '实付',
      '实收',
      '应付',
      '总计',
      '总额',
      '实付金额',
      '付款金额',
      'montant',
      'total TTC',
      'net à payer',
      'payé',
      'à payer',
      'montant TTC',
    ],
    exclude: [
      'subtotal',
      'sub total',
      'change',
      'tax',
      'cash',
      'tendered',
      'accepted total',
      'discount',
      'unit price',
      '小计',
      '找零',
      '税',
      '税额',
      '现金',
      '优惠',
      '折扣',
      '单价',
      'sous-total',
      'HT',
      'monnaie rendue',
      'rendu',
      'TVA',
      'espèces',
      'remise',
    ],
  },
  tax: {
    names: ['tax', 'vat', 'gst', '税额', '税', '税金', 'tva', 'taxe'],
    keywords: [
      'tax',
      'vat',
      'gst',
      'sales tax',
      'tax amount',
      '税额',
      '税',
      '增值税',
      '税金',
      'TVA',
      'taxe',
      'montant TVA',
    ],
    exclude: [
      'subtotal',
      'total',
      'change',
      'cash',
      '合计',
      '小计',
      '实付',
      '找零',
      'total TTC',
      'sous-total',
      'HT',
      'monnaie rendue',
    ],
  },
  issueDate: {
    names: [
      'date',
      'purchase date',
      'invoice date',
      'issue date',
      '日期',
      '消费日期',
      '开票日期',
      '交易日期',
      "date d'achat",
      'date de facture',
    ],
    keywords: [
      'date',
      'purchase date',
      'invoice date',
      'issue date',
      'transaction date',
      'date of purchase',
      '日期',
      '消费日期',
      '开票日期',
      '交易日期',
      '时间',
      "date d'achat",
      'date de facture',
      'émis le',
    ],
    exclude: [
      'due date',
      'due',
      'expiry',
      'expires',
      'valid until',
      'printed',
      '到期',
      '到期日',
      '有效期',
      '打印时间',
      '截止',
      'échéance',
      "date d'échéance",
      'expire',
      "valable jusqu'au",
    ],
  },
  dueDate: {
    names: [
      'due date',
      'due',
      'ends on',
      'end date',
      'expiry',
      'expiry date',
      'valid until',
      '到期日',
      '到期',
      '截止日期',
      '有效期至',
      '结束日期',
      'échéance',
      "date d'échéance",
      'date de fin',
      'date limite',
    ],
    keywords: [
      'due',
      'due date',
      'payment due',
      'pay by',
      'expiry',
      'expires',
      'valid until',
      'end date',
      'ends',
      '到期',
      '到期日',
      '截止',
      '截止日期',
      '有效期至',
      '缴费截止',
      '结束日期',
      'échéance',
      "date d'échéance",
      'date limite',
      'à payer avant',
      'date de fin',
      'expire',
    ],
    exclude: [
      'invoice date',
      'issue date',
      'date of issue',
      'statement date',
      '开票日期',
      '开票',
      '出票日期',
      '账单日',
      'date de facture',
      'émis le',
      "date d'émission",
    ],
  },
  signDate: {
    names: [
      'signed on',
      'sign date',
      'signing date',
      'date signed',
      '签订日期',
      '签约日期',
      '签署日期',
      'date de signature',
      'signé le',
    ],
    keywords: [
      'signed',
      'signed on',
      'date of signature',
      'signature date',
      'executed on',
      '签订',
      '签订日期',
      '签署',
      '签约',
      '签约日期',
      'signé le',
      'date de signature',
      'fait le',
    ],
    exclude: ['due', 'expiry', 'end date', '到期', '截止', 'échéance', 'date de fin'],
  },
  merchant: {
    names: [
      'store',
      'merchant',
      'shop',
      'seller',
      'vendor',
      '商家',
      '店名',
      '商户',
      '门店',
      'commerçant',
      'magasin',
      'vendeur',
      'enseigne',
    ],
    keywords: [
      'store',
      'merchant',
      'shop',
      'seller',
      'vendor',
      'sold by',
      '商家',
      '店名',
      '商户',
      '销售方',
      '门店',
      'commerçant',
      'enseigne',
      'magasin',
      'vendeur',
    ],
    exclude: [
      'cashier',
      'customer',
      'buyer',
      '收银员',
      '顾客',
      '购买方',
      'caissier',
      'client',
      'acheteur',
    ],
    position: true,
  },
  company: {
    names: [
      'company',
      'issuer',
      'organization',
      'employer',
      'other party',
      'party',
      'supplier',
      '公司',
      '单位',
      '机构',
      '出具方',
      '开票方',
      '对方',
      '供应商',
      'société',
      'entreprise',
      'organisation',
      'émetteur',
      'autre partie',
      'fournisseur',
    ],
    keywords: [
      'company',
      'organization',
      'employer',
      'firm',
      'issuer',
      'issued by',
      'supplier',
      'party',
      '公司',
      '单位',
      '机构',
      '出具方',
      '开票方',
      '收款方',
      '甲方',
      '乙方',
      'société',
      'entreprise',
      'organisation',
      'émetteur',
      'fournisseur',
      'partie',
    ],
    exclude: ['customer', 'buyer', '顾客', '购买方', 'client', 'acheteur'],
    position: true,
  },
  name: {
    names: ['name', 'full name', 'contact', '姓名', '名字', '联系人', 'nom', 'nom complet'],
    keywords: [
      'name',
      'full name',
      'contact',
      '姓名',
      '名字',
      '联系人',
      'nom',
      'nom complet',
      'contact',
    ],
    exclude: [
      'company',
      'store',
      'user name',
      '公司',
      '店名',
      '用户名',
      'société',
      'magasin',
      "nom d'utilisateur",
    ],
  },
  number: {
    names: [
      'number',
      'no',
      'invoice number',
      'invoice no',
      'reference',
      'order number',
      '单号',
      '编号',
      '发票号',
      '发票号码',
      '订单号',
      '号码',
      'numéro',
      'référence',
      'numéro de facture',
    ],
    keywords: [
      'invoice number',
      'invoice no',
      'reference',
      'ref',
      'order no',
      'receipt no',
      'number',
      'bill no',
      '发票号',
      '单号',
      '发票号码',
      '订单号',
      '编号',
      '流水号',
      'numéro de facture',
      'référence',
      'facture n°',
      'n° de commande',
      'numéro',
    ],
    exclude: [
      'tel',
      'phone',
      'gst id',
      'tax id',
      'reg no',
      'cashier',
      '电话',
      '税号',
      '收银员',
      'tél',
      'SIRET',
      'TVA intracom',
      'caissier',
    ],
    kind: 'id',
  },
  phone: {
    names: [
      'phone',
      'tel',
      'telephone',
      'mobile',
      '电话',
      '手机',
      '联系电话',
      '电话号码',
      'téléphone',
      'tél',
      'portable',
    ],
    keywords: [
      'phone',
      'tel',
      'telephone',
      'mobile',
      'cell',
      '电话',
      '手机',
      '联系电话',
      '电话号码',
      'téléphone',
      'tél',
      'portable',
      'mobile',
    ],
    exclude: ['fax', 'id', 'reg no', '传真', '税号', 'fax', 'télécopie', 'SIRET'],
    kind: 'phone',
  },
  email: {
    names: ['email', 'e-mail', 'mail', '邮箱', '电子邮件', '电子邮箱', 'courriel', 'mél'],
    keywords: ['email', 'e-mail', 'mail', '邮箱', '电子邮件', '邮件', 'courriel', 'e-mail', 'mél'],
    exclude: [],
    kind: 'email',
  },
  address: {
    names: ['address', '地址', '住址', 'adresse'],
    keywords: ['address', 'addr', '地址', '住址', 'adresse'],
    exclude: ['email', 'e-mail', '邮箱', 'courriel'],
  },
  origin: {
    names: ['from', 'origin', 'departure', '出发地', '出发', '始发站', '起点', 'départ', 'origine'],
    keywords: [
      'from',
      'departure',
      'origin',
      'depart',
      '出发地',
      '出发',
      '始发站',
      '起点',
      'départ',
      'de',
      'origine',
    ],
    exclude: ['to', 'arrival', '到达', '目的地', 'arrivée', 'destination'],
  },
  destination: {
    names: ['to', 'destination', 'arrival', '目的地', '到达', '终点', '到达站', 'arrivée'],
    keywords: [
      'to',
      'destination',
      'arrival',
      'arrive',
      '目的地',
      '到达',
      '终点',
      '到达站',
      'arrivée',
      'destination',
      'à',
    ],
    exclude: ['from', 'departure', '出发', '出发地', 'départ', 'origine'],
  },
  title: {
    names: ['title', 'subject', '标题', '名称', '主题', 'titre', 'objet', 'intitulé'],
    keywords: [
      'title',
      'subject',
      're',
      '标题',
      '名称',
      '主题',
      '合同名称',
      'titre',
      'objet',
      'intitulé',
    ],
    exclude: [],
    position: true,
  },
  purpose: {
    names: ['purpose', 'reason', 'description', '事由', '用途', '摘要', 'motif', 'raison'],
    keywords: [
      'purpose',
      'reason',
      'description',
      'memo',
      '事由',
      '用途',
      '摘要',
      'motif',
      'objet',
      'description',
    ],
    exclude: [],
  },
  category: {
    names: ['category', 'type', '分类', '类别', 'catégorie'],
    keywords: [
      'category',
      'type',
      'expense type',
      'purpose',
      '分类',
      '类别',
      '用途',
      '支出类别',
      'catégorie',
      'type',
    ],
    exclude: [],
  },
};

/**
 * 预设表（D-386，templates/ 里的 JSON）的字段 ID → 概念。字段名有歧义的靠它：账单的「From」是出具方，
 * 不是出发地；合同的「到期日」和账单的一样是到期。合同的「名称」按名字认成标题。
 */
const PRESET_FIELDS: Record<string, ConceptId> = {
  merchant: 'merchant',
  issuer: 'company',
  due: 'dueDate',
  signed: 'signDate',
  ends: 'dueDate',
  party: 'company',
  reason: 'purpose',
};
/** 只在字段名也是预设表里的名字时才按 ID 认（用户自己建的同 ID 字段按名字认）。 */
const PRESET_NAMES: Record<string, readonly string[]> = {
  merchant: ['store', '商家', 'commerçant'],
  issuer: ['from', '出具方', 'émetteur'],
  due: ['due date', '到期日', 'échéance'],
  signed: ['signed on', '签订日期', 'date de signature'],
  ends: ['ends on', '到期日', 'date de fin'],
  party: ['other party', '对方', 'autre partie'],
  reason: ['purpose', '事由', 'motif'],
};

const BY_NAME = new Map<string, ConceptId>();
for (const [id, c] of Object.entries(CONCEPTS) as [ConceptId, Concept][]) {
  for (const n of c.names) if (!BY_NAME.has(norm(n))) BY_NAME.set(norm(n), id);
}

/** 字段对上的概念；对不上时 null。 */
export function conceptOf(field: Pick<Field, 'id' | 'name'>): ConceptId | null {
  const name = norm(field.name);
  const preset = PRESET_NAMES[field.id];
  if (preset?.some((n) => norm(n) === name)) return PRESET_FIELDS[field.id]!;
  return BY_NAME.get(name) ?? null;
}

export interface FieldTerms {
  concept: ConceptId | null;
  keywords: string[];
  exclude: string[];
}

/** 给标签打分用的词：字段名 + 概念的三语关键词；排除词同样三语。 */
export function fieldTerms(field: Pick<Field, 'id' | 'name'>): FieldTerms {
  const concept = conceptOf(field);
  const c = concept ? CONCEPTS[concept] : null;
  return {
    concept,
    keywords: [field.name, ...(c?.keywords ?? [])],
    exclude: [...(c?.exclude ?? [])],
  };
}
