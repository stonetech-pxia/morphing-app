// 票据预填规则的词表（逻辑在 rules.ts、rules-text.ts；D-403）。词表在任何界面语言下都生效，App 不知道票据来自哪国。

// ---- 合计：日语、土耳其语 ----
export const EXTRA_AMOUNT_KEYWORDS = ['合計', 'toplam', 'genel toplam', 'toplm'];
export const EXTRA_AMOUNT_EXCLUDE = ['小計', 'お預り', 'お預かり', 'お釣り', 'topkdv'];
/** 整标签（去标点后）等于这些词才排除。 */
export const AMOUNT_EXCLUDE_EXACT = ['現金', 'nakit'];

// ---- 税额词：日语、加拿大 HST、西语 ----
export const EXTRA_TAX_KEYWORDS = [
  '消費税',
  '消费税',
  '消費税等',
  '消费税等',
  '外税',
  '内税',
  '内消費税',
  '外税額',
  '外税额',
  '外税計',
  '税額',
  'hst',
  'iva',
  'impuesto',
];

// ---- 「含税合计」、数量和税额行不是合计；税字样 ----
export const TAX_INCLUDED = /incl|inc\.|included|inclusive|with\s*tax|ttc|税込|含税/i;
export const TOTAL_WORD = /total|合计|总计|合計|總計/i;
export const AMOUNT_EXCLUDE_QTY_TAX = [
  'qty',
  'quantity',
  'items',
  '点数',
  '数量',
  'vat',
  'gst',
  'hst',
  'iva',
];
export const TAX_LABEL_WORD = /tax|vat|gst|hst|iva|税/i;

// ---- 只剩 VAT、GST 这几个字母的税额标签（去掉前缀后）----
export const COMPACT_TAX = new Set(['vat', 'uat', 'gst', 'hst', 'tax', 'iva']);
export const COMPACT_TAX_PREFIX = ['sales', 'total', 'item', 'inclusive'];

// ---- 日月顺序：没有别的线索时，这些币种日在前；美元要有 $ 或 AM/PM 才月在前 ----
export const DMY_FIRST_CURRENCY = ['EGP', 'TRY', 'BRL'];
export const MDY_IF_US_MARKER_CURRENCY = ['USD'];
export const US_MARKER = /\$|\b[AP]\.?M\b/i;

// ---- 日期左边出现这些词，说明是有效期、退货期限，不是开票日 ----
export const NOT_ISSUE_DATE_LEFT =
  /有効期限|有効期間|有効|失効|までに取得|まで有効|return(?:s)?\s*(?:by|with|until|thru)|\bthru\b|through|last day|refund|exchange/i;

// ---- 「Printed」打印日期的标签 ----
export const PRINT_WORD = /print/i;

// ---- 标题行（单据名）----
export const TITLE_WORDS_LATIN = [
  'tax invoice',
  'invoice',
  'receipt',
  'sales receipt',
  'cash receipt',
  'bill',
  'duplicate',
  'copy',
  'customer copy',
  'order details',
  'order',
  'fatura',
  'e-arsiv',
  'e-arşiv',
  'fis',
  'fiş',
  'adisyon',
  'satis',
  'satış',
];
export const TITLE_WORDS_CJK = [
  '領収書',
  '領収証',
  '領収',
  'レシート',
  'お買上',
  '御買上',
  '精算',
  '清算',
  '明細',
  '控',
  '伝票',
  '发票',
  '收据',
  '小票',
];

// ---- 店名前缀、标签 ----
export const MERCHANT_PREFIX = [
  'welcome to ',
  'thank you for ordering from ',
  'thank you for shopping at ',
  'thank you for visiting ',
];
export const MERCHANT_LABEL = [
  'store name',
  'sold by',
  'merchant',
  'seller',
  'vendor',
  '事業者名',
  '加盟店',
  '店名',
];

// ---- 公司后缀 ----
export const COMPANY_SUFFIX_LATIN = [
  'llc',
  'l.l.c',
  'ltd',
  'inc',
  'gmbh',
  'sdn bhd',
  's.a.e',
  's.a.',
  'a.s.',
  'a.ş.',
  'co.',
  'pty',
  'plc',
  'w.l.l',
];
export const COMPANY_SUFFIX_CJK = ['株式会社', '(株)', '（株）', '有限会社'];

// ======== 西方语言合计、税额词（法、西、德、意，带葡、荷）========
// 词表在任何界面语言下都生效（App 不知道票据来自哪国）。
export const WEST_AMOUNT_KEYWORDS = [
  // fr
  'total ttc',
  'total à payer',
  'total general',
  'total facture',
  'montant total',
  'montant à payer',
  'total dû',
  'solde à payer',
  'total net',
  // es
  'total a pagar',
  'importe total',
  'total factura',
  'importe',
  'total euros',
  'a pagar',
  'total general',
  'suma total',
  'importe a pagar',
  'total venta',
  // de
  'summe',
  'gesamt',
  'gesamtsumme',
  'gesamtbetrag',
  'endbetrag',
  'endsumme',
  'zu zahlen',
  'zahlbetrag',
  'rechnungsbetrag',
  'bruttobetrag',
  'betrag',
  'gesamtpreis',
  // it
  'totale',
  'totale complessivo',
  'totale euro',
  'totale da pagare',
  'importo',
  'importo totale',
  'da pagare',
  'importo pagato',
  'totale fattura',
  'totale documento',
  'totale generale',
  // pt / nl
  'valor total',
  'total geral',
  'valor a pagar',
  'totaal',
  'totaal te betalen',
  'te betalen',
  'totaalbedrag',
  'totaal bedrag',
];
export const WEST_AMOUNT_EXCLUDE = [
  // fr：付款、找零、税前
  'montant remis',
  'remis',
  'rendu',
  'reçu',
  'espèces',
  'sous total',
  'total ht',
  'dont tva',
  'monnaie',
  'acompte',
  'réduction',
  // es
  'base imponible',
  'cambio',
  'efectivo',
  'entregado',
  'cuota',
  'descuento',
  'recibido',
  'devolución',
  'dto',
  // de
  'zwischensumme',
  'netto',
  'nettobetrag',
  'mwst',
  'ust',
  'steuer',
  'rückgeld',
  'rueckgeld',
  'gegeben',
  'zurück',
  'rabatt',
  // it
  'subtotale',
  'imponibile',
  'resto',
  'contanti',
  'contante',
  'sconto',
  'arrotondamento',
  'di cui iva',
  // pt / nl
  'troco',
  'dinheiro',
  'desconto',
  'subtotaal',
  'btw',
  'wisselgeld',
  'contant',
  'korting',
];
export const WEST_TAX_KEYWORDS = [
  'dont tva',
  'montant tva',
  'taxe',
  'cuota iva',
  'i.v.a',
  'mehrwertsteuer',
  'umsatzsteuer',
  'enth. mwst',
  'enthaltene mwst',
  'mwst',
  'ust',
  'steuer',
  'di cui iva',
  'imposta',
  'btw',
  'omzetbelasting',
  'imposto',
];
export const WEST_TAX_EXCLUDE = [
  'base imponible',
  'imponibile',
  'base imposable',
  'netto',
  'nettobetrag',
  'zwischensumme',
  'subtotale',
  'subtotal',
  'totale',
  'gesamt',
  'summe',
  'total ttc',
  'subtotaal',
  'totaal',
];

// ======== 日月顺序：欧元、英镑、增值税字样、GST ========
/** 表的币种是这些时，年在后的数字日期日在前（欧元区、英国；合成数据 EUR 442/442、GBP 152/152 日在前）。 */
export const DMY_TABLE_CURRENCY = ['EUR', 'GBP'];
/** 文字里出现这些货币写法，票据多半来自日在前的国家（wild+restaurant 里 25/25 日在前）。 */
export const DMY_TEXT_CURRENCY = /€|£|\bEUR\b|\bGBP\b/;
/** 增值税字样（VAT、TVA、MwSt、IVA、BTW）；同一份文字里有 $ 的不算（美国发票也写 VAT）。 */
export const VAT_WORD = /(^|[^A-Za-z])(?:VAT|TVA|MwSt|IVA|I\.V\.A|BTW|USt)(?![A-Za-z])/i;
/** 有 GST 又没有 HST、PST、QST（加拿大省税）：多半是澳、新、印、新加坡的票据，日在前。 */
export const GST_WORD = /(^|[^A-Za-z])GST(?![A-Za-z])/;
export const CANADA_TAX_WORD = /(^|[^A-Za-z])(?:HST|PST|QST|TVQ)(?![A-Za-z])/;

// ======== 月份名（去掉重音、小写后查）========
const M = (m: number, ...names: string[]): [string, number][] => names.map((n) => [n, m]);
export const MONTHS_WEST: Record<string, number> = Object.fromEntries([
  ...M(
    1,
    'jan',
    'january',
    'janvier',
    'janv',
    'enero',
    'ene',
    'januar',
    'januari',
    'gennaio',
    'gen',
    'janeiro',
  ),
  ...M(
    2,
    'feb',
    'february',
    'fevrier',
    'fevr',
    'fev',
    'febrero',
    'februar',
    'februari',
    'febbraio',
    'fevereiro',
  ),
  ...M(3, 'mar', 'march', 'mars', 'marzo', 'marz', 'maerz', 'maart', 'mrt', 'marco'),
  ...M(4, 'apr', 'april', 'avril', 'avr', 'abril', 'abr', 'aprile'),
  ...M(5, 'may', 'mai', 'mayo', 'mei', 'maggio', 'mag', 'maio'),
  ...M(6, 'jun', 'june', 'juin', 'junio', 'juni', 'giugno', 'giu', 'junho'),
  ...M(7, 'jul', 'july', 'juillet', 'juil', 'julio', 'juli', 'luglio', 'lug', 'julho'),
  ...M(8, 'aug', 'august', 'aout', 'agosto', 'ago', 'augustus', 'agost'),
  ...M(
    9,
    'sep',
    'sept',
    'september',
    'septembre',
    'septiembre',
    'sep',
    'settembre',
    'set',
    'setembro',
  ),
  ...M(
    10,
    'oct',
    'october',
    'octobre',
    'octubre',
    'okt',
    'oktober',
    'ottobre',
    'ott',
    'out',
    'outubro',
  ),
  ...M(11, 'nov', 'november', 'novembre', 'noviembre', 'novembro'),
  ...M(
    12,
    'dec',
    'december',
    'decembre',
    'diciembre',
    'dic',
    'dez',
    'dezember',
    'dicembre',
    'dezembro',
  ),
]);
/** 酒店账单取最晚日期时，这些字样后面的日期是打印日期，不算。 */
export const PRINT_WORD_LEFT = /print|imprim|gedruckt|stampa|impres/i;

// ======== 店名：发票和小票分开 ========
/** 发票上才常见的词（英、法、西、德、意）；不同的词出现 ≥ 2 个才算发票。 */
export const INVOICE_TERMS: RegExp[] = [
  /bill(?:ed)?\s*to/,
  /sold\s*to/,
  /ship(?:ped)?\s*to/,
  /remit(?:tance)?\s*to/,
  /due\s*date/,
  /payment\s*terms/,
  /\bterms\b/,
  /net\s*\d+/,
  /purchase\s*order/,
  /\bp\.?\s?o\.?\s*(?:no|number|#)/,
  /amount\s*due/,
  /balance\s*due/,
  /invoice\s*(?:no|number|#|date)/,
  /\binvoice\b/,
  /bill\s*from/,
  /customer\s*(?:no|number|id)/,
  /\bcustomer\b/,
  /\bfacture\b/,
  /factur[ée]e?\s*[àa]\b/,
  /conditions\s*de\s*paiement/,
  /bon\s*de\s*commande/,
  /[ée]ch[ée]ance/,
  /\bfactura\b/,
  /fecha\s*de\s*vencimiento/,
  /condiciones\s*de\s*pago/,
  /orden\s*de\s*compra/,
  /\brechnung\b/,
  /rechnungs(?:nummer|datum)/,
  /zahlungsbedingungen/,
  /\bkunde\b/,
  /f[äa]llig/,
  /\bfattura\b/,
  /scadenza/,
  /condizioni\s*di\s*pagamento/,
];
export const INVOICE_MIN_TERMS = 2;
/** 发票上开票方的标签（只在发票里加）。 */
export const SELLER_KEYWORDS = [
  'remit to',
  'payable to',
  'pay to',
  'make checks payable to',
  'make check payable to',
  'make payable to',
  'issued by',
  'supplier',
  'bill from',
  'from',
  'fournisseur',
  'émetteur',
  'proveedor',
  'emisor',
  'lieferant',
  'aussteller',
  'fornitore',
  'emittente',
];
/** 收票方的标签（发票里当排除）。 */
export const BUYER_EXCLUDE = [
  'bill to',
  'sold to',
  'ship to',
  'deliver to',
  'attn',
  'customer',
  'buyer',
  'facturer à',
  'livrer à',
  'client',
  'destinataire',
  'facturar a',
  'cliente',
  'enviar a',
  'rechnung an',
  'kunde',
  'lieferadresse',
  'fatturare a',
  'spedire a',
];
export const SELLER_WEIGHT = 1;
/** 标签里开票方词前面允许出现的词（Please remit to、Invoice send remittance to）。 */
export const SELLER_PREFIX = [
  'please',
  'send',
  'mail',
  'invoice',
  'all',
  'make',
  'our',
  'kindly',
  'payment',
  'remittance',
];

// ======== 开票日期：这些词出现在标签里的日期不是开票日（开始、结束、期间、收到、送达……）========
export const NOT_ISSUE_DATE_LABEL = [
  'start',
  'starting',
  'begin',
  'beginning',
  'end',
  'ending',
  'from',
  'through',
  'thru',
  'period',
  'run dates',
  'flight',
  'air date',
  'effective',
  'check date',
  'cheque',
  'delivery',
  'delivered',
  'shipped',
  'ship date',
  'shipping',
  'balance as of',
  'as of',
  'last update',
  'updated',
  'sent',
  'valid',
  'contract date',
  'début',
  'debut',
  'fin',
  'période',
  'periode',
  'livraison',
  'expédition',
  'réception',
  'validité',
  'inicio',
  'periodo',
  'vencimiento',
  'entrega',
  'envío',
  'recepción',
  'validez',
  'beginn',
  'ende',
  'zeitraum',
  'fällig',
  'fälligkeit',
  'lieferdatum',
  'lieferung',
  'versand',
  'gültig',
  'inizio',
  'fine',
  'scadenza',
  'consegna',
  'spedizione',
  'valido',
];

// ======== 税字样：整份文字里一个都没有，就说明这张票没写税，没有标签的数不当税额 ========
// 拉丁、西里尔字母的词要整词匹配（taxi、relax 不算）；中日韩、泰、阿拉伯文不用空格分词，
// 税字样常常粘在别的字上（「消费税」「الضريبة」），按子串匹配。多认几个词只会少扣一分，不会多给候选。
const TAX_WORDS_SPACED = [
  // en / fr / es / de / it / nl / pt（葡语 icms 是巴西的商品流通税）
  'tax',
  'taxes',
  'taxe',
  'vat',
  'gst',
  'hst',
  'pst',
  'qst',
  'tva',
  'iva',
  'mwst',
  'ust',
  'btw',
  'imposta',
  'imposte',
  'impuesto',
  'impuestos',
  'steuer',
  'mehrwertsteuer',
  'umsatzsteuer',
  'belasting',
  'tps',
  'tvq',
  'sales\\s+tax',
  'salestax',
  'imposto',
  'impostos',
  'icms',
  // 土耳其语（verg[iİı] 是因为大写的 İ 在不区分大小写时对不上 i）、波兰语、俄语、
  // 马来、印尼语、北欧、捷克、匈牙利、芬兰、希腊语
  'kdv',
  'topkdv',
  'verg[iİı]',
  'ptu',
  'podat\\p{L}*',
  'ндс',
  'налог\\p{L}*',
  'pajak',
  'ppn',
  'pb1',
  'sst',
  'cukai',
  'moms',
  'mva',
  'dph',
  'áfa',
  'afa',
  'alv',
  'φπα',
];
const TAX_WORDS_UNSPACED = [
  // 中文（含繁体）、日文：消费税、税額、税込、稅
  '税',
  '稅',
  // 韩文：부가세、부가가치세、세금、세액、소비세、과세、면세
  '부가세',
  '부가가치세',
  '세금',
  '세액',
  '소비세',
  '과세',
  '면세',
  // 阿拉伯文：ضريبة（带「ال」也认）、ضرائب、ض.ق.م（增值税简写）、القيمة المضافة
  'ضريب',
  'ضرائب',
  'ض\\.?\\s?ق\\.?\\s?م',
  'قيمة\\s+مضافة',
  // 泰文、越南文、希伯来文
  'ภาษี',
  'thuế',
  'מע["״]?מ',
];
export const TAX_WORD = new RegExp(
  `(^|[^\\p{L}])(?:${TAX_WORDS_SPACED.join('|')})(?![\\p{L}])|${TAX_WORDS_UNSPACED.join('|')}`,
  'iu',
);
