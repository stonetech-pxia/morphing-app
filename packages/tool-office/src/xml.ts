// 读外来的 docx / xlsx（D-509）用的最小 XML 解析：只认元素、属性和文字，不处理 DTD（不解析实体定义，
// 也就没有外部实体），CDATA 当文字，注释和处理指令跳过。纯 TS，Hermes 上也能跑（不用 DOMParser）。
// 名字按命名空间归一：同一个命名空间不管文件里用什么前缀，都写成固定的前缀（Strict 格式的 docx
// 用另一套命名空间地址，也归到 w:、r: 这些上），没认出的命名空间保留文件里的前缀。

export interface XmlElement {
  /** 归一后的名字，例如 w:p、r:id；没有命名空间的就是本地名。 */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

/** 命名空间地址 → 固定的前缀（Transitional 和 Strict 两套地址）。 */
const PREFIX_OF: Record<string, string> = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
  'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://purl.oclc.org/ooxml/drawingml/main': 'a',
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'wp',
  'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing': 'wp',
  'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic',
  'http://purl.oclc.org/ooxml/drawingml/picture': 'pic',
  'http://schemas.openxmlformats.org/officeDocument/2006/math': 'm',
  'http://purl.oclc.org/ooxml/officeDocument/math': 'm',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape': 'wps',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup': 'wpg',
  'urn:schemas-microsoft-com:vml': 'v',
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main': 'x',
  'http://purl.oclc.org/ooxml/spreadsheetml/main': 'x',
  'http://schemas.openxmlformats.org/package/2006/relationships': 'pr',
  'http://www.w3.org/XML/1998/namespace': 'xml',
};

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** 文字里的实体换成字；认不出的原样留着。 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[body] ?? all;
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** 解析一整份 XML，返回根元素；不是 XML（没有根元素）时抛错。 */
export function parseXml(text: string): XmlElement {
  // 文件开头的 BOM 不算。
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const root: XmlElement = { name: '#root', attrs: {}, children: [] };
  const stack: { el: XmlElement; ns: Record<string, string> }[] = [{ el: root, ns: {} }];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const end = lt < 0 ? n : lt;
    // 只有空白的文字也留着：<w:t xml:space="preserve"> </w:t> 里的空格是字。
    if (end > i && stack.length > 1)
      stack.at(-1)!.el.children.push(decodeEntities(src.slice(i, end)));
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) {
      const close = src.indexOf('-->', lt + 4);
      i = close < 0 ? n : close + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const close = src.indexOf(']]>', lt + 9);
      const body = src.slice(lt + 9, close < 0 ? n : close);
      if (stack.length > 1) stack.at(-1)!.el.children.push(body);
      i = close < 0 ? n : close + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      // 处理指令、DOCTYPE：跳过（DOCTYPE 里的实体定义不读）。
      const close = src.indexOf('>', lt + 2);
      i = close < 0 ? n : close + 1;
      continue;
    }
    const gt = tagEnd(src, lt + 1);
    if (gt < 0) throw new Error('unterminated tag');
    const tag = src.slice(lt + 1, gt);
    i = gt + 1;
    if (tag[0] === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const space = body.search(/\s/);
    const rawName = space < 0 ? body : body.slice(0, space);
    const rawAttrs: [string, string][] = [];
    if (space >= 0) {
      ATTR.lastIndex = 0;
      for (let m = ATTR.exec(body); m; m = ATTR.exec(body)) {
        rawAttrs.push([m[1]!, decodeEntities(m[3] ?? m[4] ?? '')]);
      }
    }
    const parentNs = stack.at(-1)!.ns;
    let ns = parentNs;
    for (const [key, value] of rawAttrs) {
      if (key === 'xmlns' || key.startsWith('xmlns:')) {
        if (ns === parentNs) ns = { ...parentNs };
        ns[key === 'xmlns' ? '' : key.slice(6)] = value;
      }
    }
    const qualify = (raw: string, useDefault: boolean) => {
      const colon = raw.indexOf(':');
      const prefix = colon < 0 ? '' : raw.slice(0, colon);
      const local = colon < 0 ? raw : raw.slice(colon + 1);
      if (!prefix && !useDefault) return local;
      if (prefix === 'xml') return `xml:${local}`;
      const uri = ns[prefix];
      const fixed = uri !== undefined ? PREFIX_OF[uri] : undefined;
      if (fixed) return `${fixed}:${local}`;
      return prefix ? `${prefix}:${local}` : local;
    };
    const attrs: Record<string, string> = {};
    for (const [key, value] of rawAttrs) {
      if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
      attrs[qualify(key, false)] = value;
    }
    const el: XmlElement = { name: qualify(rawName, true), attrs, children: [] };
    stack.at(-1)!.el.children.push(el);
    if (!selfClosing) stack.push({ el, ns });
  }
  const top = root.children.find((c): c is XmlElement => typeof c !== 'string');
  if (!top) throw new Error('no root element');
  return top;
}

/** 标签的结束位置（属性值里的 > 不算）。 */
function tagEnd(src: string, from: number): number {
  let quote = '';
  for (let i = from; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

export const isElement = (node: XmlNode | undefined): node is XmlElement =>
  typeof node === 'object' && node !== null;

/** 名字是 name 的第一个子元素。 */
export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (isElement(c) && c.name === name) return c;
  return undefined;
}

/** 名字是 name 的所有子元素（不写名字时是所有子元素）。 */
export function children(el: XmlElement | undefined, name?: string): XmlElement[] {
  if (!el) return [];
  return el.children.filter((c): c is XmlElement => isElement(c) && (!name || c.name === name));
}

/** 所有名字是 name 的后代元素（深度优先、按文件里的顺序）。 */
export function descendants(el: XmlElement | undefined, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (e: XmlElement) => {
    for (const c of e.children) {
      if (!isElement(c)) continue;
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  if (el) walk(el);
  return out;
}

/** 元素里直接的文字（不含子元素里的）。 */
export const ownText = (el: XmlElement | undefined) =>
  el ? el.children.filter((c): c is string => typeof c === 'string').join('') : '';
