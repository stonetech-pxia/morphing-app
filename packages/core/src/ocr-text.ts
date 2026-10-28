import { T2S_FROM, T2S_TO } from './ocr-t2s';

// 识别结果整理成文字（D-268）：按位置排成行和段，同一段里因为排版折行的行接回去（复制出来是完整的段落）；
// 简体中文把混进来的繁体字换回简体；中文旁边的半角标点换成全角。都在本机做，不改动识别出的字以外的内容。

/** 识别出的一行：像素坐标，原点在左上角。 */
export interface OcrLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 中日韩文字和全角标点。 */
const CJK =
  '\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef';
const IS_CJK = new RegExp(`[${CJK}]`);
/** 列表项的开头：项目符号、「1.」「2、」「(3)」「①」。 */
const LIST_ITEM = /^\s*(?:[•·\-–—*▪●○◦■□]|\d{1,3}[.、)）]|[(（]\d{1,3}[)）]|[①-⑳])/;

interface Row {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1]! : 0;
}

/** 两行之间怎么接：中日韩文字之间不加空格；英文行尾「词-」接小写字母时去掉连字符；其余加一个空格。 */
function joiner(prev: string, next: string): { prev: string; sep: string } {
  const last = prev.slice(-1);
  const first = next.charAt(0);
  if (IS_CJK.test(last) || IS_CJK.test(first)) return { prev, sep: '' };
  if (/[A-Za-zÀ-ɏ]-$/.test(prev) && /^[a-zà-ÿ]/.test(next))
    return { prev: prev.slice(0, -1), sep: '' };
  return { prev, sep: ' ' };
}

/**
 * 把识别出的行排成文字：先按竖直方向的重叠分成一排一排（同一排的几块从左到右用空格接上），
 * 上下间距超过一行半的地方空一行（分段）。同一段里，写到右边、下一行又没有缩进也不是列表项的，
 * 是排版折行，接成一行。
 */
export function layoutOcrLines(lines: readonly OcrLine[]): string {
  const items = lines.filter((l) => l.text.trim());
  if (items.length === 0) return '';
  const typical = median(items.map((l) => l.height)) || 1;
  const sorted = [...items].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const groups: OcrLine[][] = [];
  for (const line of sorted) {
    const first = groups.at(-1)?.[0];
    if (first) {
      const overlap =
        Math.min(first.y + first.height, line.y + line.height) - Math.max(first.y, line.y);
      if (overlap >= 0.5 * Math.min(first.height, line.height)) {
        groups.at(-1)!.push(line);
        continue;
      }
    }
    groups.push([line]);
  }
  const rows: Row[] = groups.map((group) => {
    const ordered = group.sort((a, b) => a.x - b.x);
    return {
      text: ordered.map((l) => l.text.trim()).join(' '),
      left: Math.min(...ordered.map((l) => l.x)),
      right: Math.max(...ordered.map((l) => l.x + l.width)),
      top: Math.min(...ordered.map((l) => l.y)),
      bottom: Math.max(...ordered.map((l) => l.y + l.height)),
    };
  });
  // 分段：上下间距超过一行半就是新的一段。
  const blocks: Row[][] = [];
  for (const row of rows) {
    const block = blocks.at(-1);
    const prev = block?.at(-1);
    if (block && prev && row.top - prev.bottom <= 1.2 * typical) block.push(row);
    else blocks.push([row]);
  }
  return blocks
    .map((block) => {
      const left = Math.min(...block.map((r) => r.left));
      const right = Math.max(...block.map((r) => r.right));
      const out: string[] = [];
      for (const [i, row] of block.entries()) {
        const prev = block[i - 1];
        const wrapped =
          prev !== undefined &&
          prev.right >= right - 1.2 * typical &&
          prev.right - prev.left >= 0.6 * (right - left) &&
          row.left <= left + typical &&
          !LIST_ITEM.test(row.text);
        if (wrapped && out.length > 0) {
          const { prev: head, sep } = joiner(out.at(-1)!, row.text);
          out[out.length - 1] = head + sep + row.text;
        } else out.push(row.text);
      }
      return out.join('\n');
    })
    .join('\n\n');
}

let t2s: Map<string, string> | null = null;

/** 简体中文的识别结果里混进来的繁体字换成简体（只换一对一、简体里不会用到的字，D-268）。 */
export function toSimplifiedChinese(text: string): string {
  if (!t2s) {
    const from = [...T2S_FROM];
    const to = [...T2S_TO];
    t2s = new Map(from.map((c, i) => [c, to[i]!]));
  }
  const map = t2s;
  return Array.from(text, (c) => map.get(c) ?? c).join('');
}

const FULL: Record<string, string> = {
  ',': '，',
  ':': '：',
  ';': '；',
  '?': '？',
  '!': '！',
  '(': '（',
  ')': '）',
};

/**
 * 中文旁边的半角标点换成全角（识别器常把「，：（）」认成半角）：逗号、冒号、分号挨着中文时换
 * （数字之间的 1,000、12:30 两边不是中文，不换）；句点只在中文后面、后面不是字母数字时换成「。」；
 * 问号、叹号跟在中文后面时换；括号里面或外面挨着中文时换，左右括号一起换。全角标点两边的空格去掉。
 */
export function cjkPunctuation(text: string): string {
  const chars = Array.from(text);
  const isCjk = (c: string | undefined) => c !== undefined && IS_CJK.test(c);
  // 左括号换没换，右括号跟着一样（「像素(px)」→「像素（px）」）。
  const open: boolean[] = [];
  const out = chars.map((c, i) => {
    const prev = chars[i - 1];
    const next = chars[i + 1];
    // 半角标点前后可能隔着一个空格（「中文 , 中文」）。
    const before = prev === ' ' ? chars[i - 2] : prev;
    const after = next === ' ' ? chars[i + 2] : next;
    switch (c) {
      case ',':
      case ':':
      case ';':
        return isCjk(before) || isCjk(after) ? FULL[c]! : c;
      case '.':
        return isCjk(before) && !/[0-9A-Za-z]/.test(after ?? '') ? '。' : c;
      case '?':
      case '!':
        return isCjk(before) ? FULL[c]! : c;
      case '(': {
        const full = isCjk(after) || isCjk(before);
        open.push(full);
        return full ? FULL[c]! : c;
      }
      case ')': {
        const full = open.pop() ?? (isCjk(before) || isCjk(after));
        return full ? FULL[c]! : c;
      }
      default:
        return c;
    }
  });
  return out.join('').replace(/ *([，。：；？！（）、]) */g, '$1');
}

/** 一种识别语言的整理：简体中文换繁体、换标点；繁体中文只换标点；其他语言原样（D-268）。 */
export function polishOcrText(text: string, lang: 'zh-Hans' | 'zh-Hant' | 'other'): string {
  if (lang === 'zh-Hans') return cjkPunctuation(toSimplifiedChinese(text));
  if (lang === 'zh-Hant') return cjkPunctuation(text);
  return text;
}
