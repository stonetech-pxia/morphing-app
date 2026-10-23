import type { Locale, Workflow, WorkflowStep, WorkspaceConfig } from '../schema';
import { WORKFLOW_PRESETS, type WorkflowPreset } from '../workflows/presets';

// mock AI 的工作流句式（docs/MOCK_AI_PHRASES.md W1–W7）：把「选照片、压到 500KB、分享」这类短语
// 翻译成步骤。只认识固定的说法；认不出的短语返回 null，由调用方整句拒绝。

/** 一个步骤短语 → 动作和参数。 */
export interface StepPhrase {
  action: string;
  params: Record<string, unknown>;
}

const num = (s: string) => Number(s.replace(/,/g, ''));

/** 「500KB」「2 MB」「1.5MB」→ KB。 */
function sizeKB(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(kb|mb|k|m|兆)/i.exec(text);
  if (!m) return null;
  const n = num(m[1]!);
  return /^(mb|m|兆)$/i.test(m[2]!) ? Math.round(n * 1024) : Math.round(n);
}

type Matcher = [RegExp, (m: RegExpMatchArray, locale: Locale) => StepPhrase];

const STEP_PHRASES: Matcher[] = [
  [
    /^(?:从相册)?(?:选|选择|挑)(?:几张|多张|一张)?(?:照片|图片|截图)$|^(?:choose|pick|select) (?:some |a )?(?:photos?|pictures?|images?|screenshots?)$/i,
    () => ({ action: 'in.photos', params: { source: 'library', min: 1, max: 30 } }),
  ],
  [
    // 文档相机（D-084）：实时找边、自动拍、多页；单说「扫描」仍是找边拉正（scan.detect）。
    /^(?:用文档相机)?扫描(?:文档|纸张|收据|几页纸?)$|^scan (?:documents?|paper|pages|receipts?)$/i,
    () => ({ action: 'in.photos', params: { source: 'scanner', min: 1, max: 30 } }),
  ],
  [
    /^拍(?:照|照片|一张|几张)?$|^take (?:a )?(?:photos?|pictures?)$/i,
    () => ({ action: 'in.photos', params: { source: 'camera', min: 1, max: 10 } }),
  ],
  [
    /^(?:选|选择)\s*pdf\s*(?:和|或)\s*(?:图片|照片)$|^(?:choose|pick) pdfs? and (?:images|photos)$/i,
    () => ({ action: 'in.files', params: { accept: 'pdfOrImages', min: 1, max: 30 } }),
  ],
  [
    /^(?:选|选择)\s*(?:一个|几个)?\s*pdf$|^(?:choose|pick|select) (?:a |some )?pdfs?$/i,
    () => ({ action: 'in.files', params: { accept: 'pdf', min: 1, max: 10 } }),
  ],
  [
    /^(?:选|选择)(?:文件|几个文件)$|^(?:choose|pick|select) (?:some )?files$/i,
    () => ({ action: 'in.files', params: { accept: 'any', min: 1, max: 30 } }),
  ],
  [
    /^(?:压缩)?(?:压到|压缩到|小于|不超过)\s*(\d+(?:\.\d+)?\s*(?:kb|k|mb|m|兆))\s*(?:以内|以下)?$|^compress (?:it |them |each )?(?:to|under|below) (\d+(?:\.\d+)?\s*(?:kb|mb))$/i,
    (m) => ({
      action: 'image.compress',
      params: { maxKB: sizeKB(m[1] ?? m[2]!)!, format: 'jpeg' },
    }),
  ],
  [
    /^(?:长边|缩到|改成长边)\s*(\d+)\s*(?:像素|px)?$|^(?:resize to|long side) (\d+)\s*(?:px)?$/i,
    (m) => ({ action: 'image.resize', params: { mode: 'longEdge', px: num(m[1] ?? m[2]!) } }),
  ],
  [
    /^(?:转|转成|转换成|改成)\s*(jpg|jpeg|png|webp)(?:\s*格式)?$|^convert to (jpg|jpeg|png|webp)$/i,
    (m) => {
      const f = (m[1] ?? m[2]!).toLowerCase();
      const format = f === 'jpg' ? 'jpeg' : f;
      return {
        action: 'image.convert',
        params: { format, quality: format === 'png' ? 100 : format === 'webp' ? 80 : 85 },
      };
    },
  ],
  [
    /^(?:去掉|去除|删除)(?:定位|位置|位置信息|地理位置)$|^remove (?:the )?(?:location|gps)(?: info)?$/i,
    () => ({ action: 'image.stripMetadata', params: {} }),
  ],
  [/^(?:裁剪|裁切)$|^crop$/i, () => ({ action: 'image.crop', params: { aspect: 'free' } })],
  [
    /^(?:排序|排好顺序|调整顺序)$|^(?:put (?:them )?in order|reorder)$/i,
    () => ({ action: 'file.order', params: {} }),
  ],
  [
    /^拼(?:成)?长图$|^stitch(?: into a long image)?$/i,
    () => ({
      action: 'image.stitch',
      params: { direction: 'vertical', gapPx: 0, background: '#FFFFFF' },
    }),
  ],
  [
    /^打码$|^(?:redact|hide (?:private )?parts)$/i,
    () => ({ action: 'image.redact', params: { style: 'black' } }),
  ],
  [/^(?:扫描|找边|拉正)$|^(?:scan|straighten)$/i, () => ({ action: 'scan.detect', params: {} })],
  [
    /^(?:识别文字|文字识别|提取文字)$|^(?:recognize|read|extract) (?:the )?text$/i,
    (_m, locale) => ({
      action: 'ocr.recognize',
      params: { lang: locale === 'zh' ? 'chi_sim' : 'eng' },
    }),
  ],
  [
    /^(?:合成|转成|生成|做成)\s*(?:一个)?\s*pdf$|^(?:make|create) (?:a |one )?pdf$/i,
    () => ({
      action: 'pdf.fromImages',
      params: { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 0 },
    }),
  ],
  [
    /^(?:合并|合并成一个)\s*(?:pdf)?$|^merge(?: into one pdf)?$/i,
    () => ({ action: 'pdf.merge', params: { imagePage: 'a4' } }),
  ],
  [/^(?:签名|签字)$|^sign(?: it)?$/i, () => ({ action: 'pdf.sign', params: {} })],
  [
    /^(?:打包|打包成|压缩成)\s*zip$|^(?:zip(?: them)?|make a zip)$/i,
    () => ({ action: 'zip.create', params: {} }),
  ],
  [
    /^(?:按|用)?\s*"?(.+?)"?\s*命名$|^name (?:it|them) "?(.+?)"?$/i,
    (m) => ({ action: 'file.rename', params: { template: (m[1] ?? m[2]!).trim() } }),
  ],
  [/^分享$|^share(?: it| them)?$/i, () => ({ action: 'out.share', params: {} })],
  [
    /^(?:保存|存到文件|存起来)$|^save(?: to files| it)?$/i,
    () => ({ action: 'file.save', params: {} }),
  ],
  [/^存到相册$|^save to photos$/i, () => ({ action: 'out.saveToPhotos', params: {} })],
  [/^打印$|^print(?: it)?$/i, () => ({ action: 'out.print', params: {} })],
];

/** 把命名短语里的「日期」换成模板。 */
export function nameTemplateOf(words: string): string {
  return words
    .replace(/日期|\bdate\b/gi, '{date:YYYY-MM-DD}')
    .replace(/原文件名|source name/gi, '{sourceName}');
}

export function parseStepPhrase(text: string, locale: Locale): StepPhrase | null {
  const clean = text.replace(/^(?:再|然后|最后|先|接着|and then|then|and)\s*/i, '').trim();
  for (const [re, make] of STEP_PHRASES) {
    const m = clean.match(re);
    if (!m) continue;
    const step = make(m, locale);
    if (step.action === 'file.rename') {
      step.params = { template: nameTemplateOf(String(step.params.template)) };
    }
    return step;
  }
  return null;
}

/** 「选照片、压到 500KB、分享」/「choose photos, compress to 500 KB, then share」→ 步骤短语。 */
export function splitStepPhrases(text: string): string[] {
  return text
    .split(/、|→|->|,|，|然后|\bthen\b|\band\b(?! (?:images|photos))/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 新步骤的 ID：动作名的后半段，重复时加序号。 */
export function stepIdFor(action: string, taken: readonly { id: string }[]): string {
  const base = action
    .split('.')[1]!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const used = new Set(taken.map((s) => s.id));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function stepsFrom(phrases: readonly StepPhrase[]): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  for (const p of phrases)
    steps.push({ id: stepIdFor(p.action, steps), action: p.action, params: p.params });
  return steps;
}

const PRESET_WORDS: [RegExp, string][] = [
  [
    /证件照打印|打印证件照|证件照冲印|print(?:ing)? id photos?|id photos? to print/i,
    'print-id-photos',
  ],
  [/签证|证件照|visa|id photo|passport photo/i, 'visa-photo'],
  [/材料包|申请材料|application packet|document packet/i, 'document-packet'],
  [/发邮件|传网站|email|upload/i, 'email-photos'],
  [/签回|签名表格|sign and (?:send|return)/i, 'sign-return'],
  [/扫描文档|扫描|scan/i, 'scan-document'],
  [/合一|多份材料|combine/i, 'combine-documents'],
  [/收据|发票|receipt/i, 'receipt-archive'],
  [/截图打码|打码|redact|hide parts/i, 'redact-screenshots'],
  [/批量发照片|发照片|send (?:many )?photos/i, 'send-photos'],
];

export function findPreset(text: string): WorkflowPreset | undefined {
  const lower = text.toLowerCase();
  const byName = WORKFLOW_PRESETS.find(
    (p) => lower.includes(p.name.zh.toLowerCase()) || lower.includes(p.name.en.toLowerCase()),
  );
  if (byName) return byName;
  const hit = PRESET_WORDS.find(([re]) => re.test(text));
  return hit ? WORKFLOW_PRESETS.find((p) => p.id === hit[1]) : undefined;
}

/** 按名字找工作流（完全相同优先，其次包含）。 */
export function findWorkflowByName(rawName: string, config: WorkspaceConfig): Workflow | undefined {
  const name = rawName
    .replace(/"/g, '')
    .replace(/(?:快捷操作|工作流|流程|workflow|quick action)$/i, '')
    .trim()
    .toLowerCase();
  if (!name) return undefined;
  const all = config.workflows;
  return (
    all.find((w) => w.name.toLowerCase() === name) ??
    all.find((w) => w.name.toLowerCase().includes(name) || name.includes(w.name.toLowerCase()))
  );
}
