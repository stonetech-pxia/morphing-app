import type { PageLines, RuleLine } from './lines';
import type { Box, OcrBox, RgbaImage } from './types';

// 表单里留着填写的地方（EU 样本 021、030）：标签后面的一串点（「Name ……………」）、标签右边的一条横线
// （L 形的答题线、一格一格的号码框的底线）。识别不出它们（点读成「...」或者干脆没有），转出来只剩标签，
// 没地方写；空出来的一大段还让标签和下面居中的说明像两栏，顺序全乱。
// 找出来以后接在同一排的标签后面，写成一串「.」（点）或「_」（横线），和原来差不多长：Word 里看得出要填，
// 也能直接改。这一排因此是整行宽的，不会被当成窄的标签列；接了填写处的行是一行一行的，不和下一行接成一段。

export interface FillIn extends Box {
  kind: 'dots' | 'rule';
}

/** 点：连通的一小块墨，长宽都不超过这么多个行高。 */
const DOT_MAX = 0.3;
/** 相邻两个点的中心最远隔这么多个行高；同一排的点上下差不超过这么多个行高。 */
const DOT_PITCH = 0.7;
const DOT_ROW = 0.15;
/** 一串点的宽高比（中位数）不超过这么多。 */
const DOT_ROUND = 1.8;
/** 一串点至少这么多个、至少这么多个行高长。 */
const DOTS_MIN = 6;
const FILL_MIN = 2.5;
/** 一串点上下这么多个行高以内不能有比点大的墨（字的笔画）：不是 i 上面的点、字里的句号。 */
const DOT_CLEAR = 0.25;
/** 横线至少这么多个行高长（再短的多半是图形、水印字的一笔）。 */
const RULE_MIN = 4;
/** 横线：不粗过这么多个行高。 */
const RULE_MAX_THICKNESS = 0.3;
/** 填写处上面这么多个行高（的八成）里，至少这么多的点是白的。 */
const BLANK_ABOVE = 0.8;
const BLANK_SHARE = 0.9;
/** 横线两头连着这么长（行高）以上的竖线，是框的边。 */
const FRAME_SIDE = 1.5;
/** 一头连着框边的横线，左头离同一排的标签不超过这么多个行高时，是画到框边的填写线。 */
const LAST_FILL_GAP = 2;
/** 横线上至少这么多的地方比线的上下两边深 LINE_CONTRAST 以上（0–255）。 */
const RULE_INK_SHARE = 0.6;
const LINE_CONTRAST = 30;
/** 横线上有墨的部分至少占这么多（实线）。 */
const RULE_SOLID = 0.9;
/** 横线左边的标签最远隔这么多个行高（表单的标签一列、填写处一列，短的标签离得远）。 */
const LABEL_GAP = 16;
/** 一串「.」「_」比原来的点、线短一点：Word 里字号放大、换了字体时也不折到下一行。 */
const FILL_SLACK = 0.85;
/** 字号（像素）≈ 识别框的高 × 这个比例（和 doc.ts 的 BOX_TO_FONT 一样）。 */
const BOX_TO_FONT = 0.9;
/** Arial 里「.」「_」的宽（em）。「…」在 LibreOffice 里单独成段时会换成中文字体，不用。 */
const RUN_EM = { dots: 0.278, rule: 0.556 } as const;
const RUN_CHAR = { dots: '.', rule: '_' } as const;
/** 文字里属于点线本身的字符（识别把点读成「...」「…」、空格）。 */
const LEADER_CHAR = /^[\s.…·_]$/u;
/** 一行字以一串填写处结尾（paragraphsOf：这样的行是一行一行的，不接下一行）。 */
export const ENDS_WITH_FILL = /(?:\.{4,}|_{4,})\s*$/u;
/** 一串填写处（比较两次排版的字时不算字）。 */
export const FILL_RUN = /(?:\.{4,}|_{4,})/gu;

/** 连通的墨块（4 邻接），只要框和点数。 */
function components(image: RgbaImage): { box: Box; count: number }[] {
  const { width, height, data } = image;
  const label = new Int32Array(width * height).fill(-1);
  // 4 邻接时临时编号最多是点数的一半（棋盘格）。
  const parent = new Int32Array((width * height) / 2 + 2);
  let next = 0;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const ink = Math.min(data[o]!, data[o + 1]!, data[o + 2]!);
      if (ink >= 140) continue;
      const p = y * width + x;
      const left = x > 0 ? label[p - 1]! : -1;
      const up = y > 0 ? label[p - width]! : -1;
      if (left < 0 && up < 0) {
        label[p] = next;
        parent[next] = next;
        next++;
      } else if (left >= 0 && up >= 0) {
        const a = find(left);
        const b = find(up);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        label[p] = Math.min(a, b);
      } else label[p] = left >= 0 ? left : up;
    }
  }
  const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number; n: number }>();
  for (let p = 0; p < label.length; p++) {
    if (label[p]! < 0) continue;
    const root = find(label[p]!);
    const x = p % width;
    const y = (p - x) / width;
    const b = boxes.get(root);
    if (!b) boxes.set(root, { x0: x, y0: y, x1: x, y1: y, n: 1 });
    else {
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y > b.y1) b.y1 = y;
      b.n++;
    }
  }
  return [...boxes.values()].map((b) => ({
    box: { x: b.x0, y: b.y0, width: b.x1 - b.x0 + 1, height: b.y1 - b.y0 + 1 },
    count: b.n,
  }));
}

const dotsCache = new WeakMap<RgbaImage, Map<number, { dots: FillIn[]; erased: RgbaImage }>>();

/**
 * 一页上的点线，和抹掉点线的图（找表格线用：点线会被当成浅的横线，几条对齐的点线连成一张假的表）。
 * 同一张图、同一个行高只算一次（转 Word 会对同一页重建好几次），抹掉的图也是同一个（找线按图缓存）。
 */
export function leaderDots(
  image: RgbaImage,
  lines: readonly OcrBox[],
  lineHeight: number,
): { dots: FillIn[]; erased: RgbaImage } {
  let byHeight = dotsCache.get(image);
  if (!byHeight) dotsCache.set(image, (byHeight = new Map()));
  let found = byHeight.get(lineHeight);
  if (!found) {
    // 识别在这串「点」的位置上读出了字母、数字的，是字（扫描件里很小的字也是一个个小墨块），不是点线。
    const dots = findDots(image, lineHeight).filter((d) => !readAsText(d, lines, lineHeight));
    let erased = image;
    if (dots.length) {
      const data = image.data.slice();
      const pad = 1;
      for (const d of dots) {
        for (let y = Math.max(0, d.y - pad); y < Math.min(image.height, d.y + d.height + pad); y++)
          for (let x = Math.max(0, d.x - pad); x < Math.min(image.width, d.x + d.width + pad); x++)
            data.fill(255, (y * image.width + x) * 4, (y * image.width + x) * 4 + 3);
      }
      erased = { width: image.width, height: image.height, data };
    }
    byHeight.set(lineHeight, (found = { dots, erased }));
  }
  return found;
}

/**
 * 一条细线（不是色块的边）：线上的每一列比线上面、下面隔开一点的地方都深一截的列占多少。
 * 浅灰的填写线（EU 样本 001）两边都是白纸；浅色底纹的边只有一边浅。
 */
function lineShare(image: RgbaImage, box: Box): number {
  const ink = (x: number, y: number) => {
    const o = (Math.max(0, Math.min(image.height - 1, y)) * image.width + x) * 4;
    return Math.min(image.data[o]!, image.data[o + 1]!, image.data[o + 2]!);
  };
  const x0 = Math.max(0, Math.round(box.x));
  const x1 = Math.min(image.width, Math.round(box.x + box.width));
  const top = Math.round(box.y) - 1;
  const bottom = Math.round(box.y + box.height) + 1;
  let thin = 0;
  for (let x = x0; x < x1; x++) {
    let line = 255;
    for (let y = top; y <= bottom; y++) line = Math.min(line, ink(x, y));
    if (ink(x, top - 3) - line >= LINE_CONTRAST && ink(x, bottom + 3) - line >= LINE_CONTRAST)
      thin++;
  }
  return x1 > x0 ? thin / (x1 - x0) : 0;
}

/** 框里浅色（三个通道都亮）的点占多少。 */
function lightShare(image: RgbaImage, box: Box): number {
  const x0 = Math.max(0, Math.round(box.x));
  const x1 = Math.min(image.width, Math.round(box.x + box.width));
  const y0 = Math.max(0, Math.round(box.y));
  const y1 = Math.min(image.height, Math.round(box.y + box.height));
  let light = 0;
  let all = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4;
      all++;
      if (Math.min(image.data[o]!, image.data[o + 1]!, image.data[o + 2]!) >= 170) light++;
    }
  }
  return all ? light / all : 0;
}

/** 和一串点同一排、盖住它的识别行里，落在它上面的字有两成以上是字母、数字。 */
function readAsText(d: FillIn, lines: readonly OcrBox[], lineHeight: number): boolean {
  let letters = 0;
  let all = 0;
  for (const l of lines) {
    if (!sameRow(l, d, lineHeight) || l.x >= d.x + d.width || l.x + l.width <= d.x) continue;
    for (const c of charsOf(l)) {
      const x = l.x + c.at * l.width;
      if (x < d.x || x > d.x + d.width || !c.text.trim()) continue;
      all++;
      if (/[\p{L}\p{N}]/u.test(c.text)) letters++;
    }
  }
  return letters > 0.2 * all;
}

/** 一串点（引导线）：同一排、间距差不多的小墨点，中间没有字。 */
function findDots(image: RgbaImage, lineHeight: number): FillIn[] {
  const all = components(image);
  const max = DOT_MAX * lineHeight;
  // 挨得近的两个点在图里常常连成一块（扁的），也算点；整串是不是圆点在下面按中位数看。
  const small = all.filter((c) => c.count >= 2 && c.box.width <= max && c.box.height <= max);
  // 字：比点高的墨。
  const big = all.filter((c) => c.count >= 2 && c.box.height > max).map((c) => c.box);
  const cx = (b: Box) => b.x + b.width / 2;
  const cy = (b: Box) => b.y + b.height / 2;
  const chains: Box[][] = [];
  for (const { box } of [...small].sort((a, b) => cx(a.box) - cx(b.box))) {
    let best: Box[] | undefined;
    for (const chain of chains) {
      const last = chain.at(-1)!;
      if (cx(box) - cx(last) > DOT_PITCH * lineHeight) continue;
      if (Math.abs(cy(box) - cy(last)) > DOT_ROW * lineHeight) continue;
      if (!best || cx(last) > cx(best.at(-1)!)) best = chain;
    }
    if (best) best.push(box);
    else chains.push([box]);
  }
  const out: FillIn[] = [];
  for (const chain of chains) {
    if (chain.length < DOTS_MIN) continue;
    const x0 = chain[0]!.x;
    const x1 = chain.at(-1)!.x + chain.at(-1)!.width;
    if (x1 - x0 < FILL_MIN * lineHeight) continue;
    // 间距大致一样（八成的间距在中位数的一半到一倍半之间）。
    const pitches = chain
      .slice(1)
      .map((b, i) => cx(b) - cx(chain[i]!))
      .sort((a, b) => a - b);
    const p = pitches[pitches.length >> 1]!;
    // 圆点（虚线的短划是扁的：小票、表格里的分隔线，不是填写处）。
    const aspects = chain.map((b) => b.width / b.height).sort((a, b) => a - b);
    if (aspects[aspects.length >> 1]! > DOT_ROUND) continue;
    if (pitches.filter((d) => d >= 0.5 * p && d <= 1.6 * p).length < 0.8 * pitches.length) continue;
    const y = Math.min(...chain.map((b) => b.y));
    const bottom = Math.max(...chain.map((b) => b.y + b.height));
    const mid = (y + bottom) / 2;
    const clear = DOT_CLEAR * lineHeight;
    if (
      big.some(
        (b) => b.x < x1 && b.x + b.width > x0 && b.y < mid + clear && b.y + b.height > mid - clear,
      )
    )
      continue;
    out.push({ kind: 'dots', x: x0, y, width: x1 - x0, height: bottom - y });
  }
  return out;
}

/**
 * 页面上留着填写的地方：一串点（leaderDots），或者一条不在表格里的细横线（左边同一排有标签、上面没有字压着：
 * 不是字的下划线、分隔线）。boxes 里的（表格、图片）不要。
 */
export function findFillIns(
  image: RgbaImage,
  dots: readonly FillIn[],
  rules: PageLines,
  lines: readonly OcrBox[],
  lineHeight: number,
  exclude: readonly Box[],
): FillIn[] {
  const inside = (b: Box) =>
    exclude.some(
      (e) =>
        b.x + b.width / 2 >= e.x &&
        b.x + b.width / 2 <= e.x + e.width &&
        b.y + b.height / 2 >= e.y - 0.5 * lineHeight &&
        b.y + b.height / 2 <= e.y + e.height + 0.5 * lineHeight,
    );
  const t = Math.tan((rules.skew * Math.PI) / 180);
  // 同一条线上断开的几段先接起来（拍歪的小票上的分隔线断成几截，中间一截不能单独当填写处）。
  const joined: RuleLine[] = [];
  for (const h of [...rules.horizontal]
    .filter((h) => !h.band && h.thickness <= RULE_MAX_THICKNESS * lineHeight)
    .sort((a, b) => a.from - b.from)) {
    const prev = joined.find(
      (j) => Math.abs(j.pos - h.pos) <= 0.3 * lineHeight && h.from - j.to <= 0.8 * lineHeight,
    );
    if (prev) {
      prev.to = Math.max(prev.to, h.to);
      prev.spans = [...prev.spans, ...h.spans];
    } else joined.push({ ...h, spans: [...h.spans] });
  }
  const solid: FillIn[] = joined
    .filter(
      (h) =>
        h.to - h.from >= RULE_MIN * lineHeight &&
        // 实线（虚线多半是小票、表格里的分隔线）。
        h.spans.reduce((n, [a, b]) => n + b - a, 0) >= RULE_SOLID * (h.to - h.from),
    )
    .map((h) => {
      // 拉正后的坐标换回原图（线不长，按中点的位置换）。
      const mid = (h.from + h.to) / 2;
      const y = h.pos + mid * t;
      const x = h.from - y * t;
      return {
        kind: 'rule' as const,
        x,
        y: y - h.thickness / 2,
        width: h.to - h.from,
        height: h.thickness,
      };
    })
    .filter((r) => {
      // 框的一条边（两头连着长的竖线：表单一节的外框，标题压在框的上边上）不是填写处；
      // L 形答题线、号码框的竖线都很短。
      const ends = [r.x, r.x + r.width];
      const framedAt = ends.map((e) =>
        rules.vertical.some((v) => {
          const vx = v.pos - (r.y + r.height / 2) * t;
          return (
            Math.abs(vx - e) <= 0.3 * lineHeight &&
            v.from <= r.y + 0.3 * lineHeight &&
            v.to >= r.y - 0.3 * lineHeight &&
            v.to - v.from >= FRAME_SIDE * lineHeight
          );
        }),
      );
      // 只有右头连着框边、左边紧挨着同一排的标签：一排里最后一个标签后面的填写线一直画到框的右边
      // （EU 样本 046 的「Provincia ……」「E-mail ……」），不是框的边。
      const afterLabel =
        !framedAt[0] &&
        lines.some(
          (l) =>
            sameRow(l, r, lineHeight) &&
            l.x + l.width <= r.x + 0.5 * lineHeight &&
            r.x - (l.x + l.width) <= LAST_FILL_GAP * lineHeight,
        );
      if (framedAt.some(Boolean) && !afterLabel) return false;
      // 压着字的不算：字的下划线、填好了的答案（字在线上面一个多行高以内），
      // 粗体字的笔画连成的「线」（线在字的框里）。
      const covered = lines.some(
        (l) =>
          Math.min(l.x + l.width, r.x + r.width) - Math.max(l.x, r.x) > lineHeight &&
          r.y >= l.y &&
          r.y <= l.y + l.height + 1.3 * lineHeight,
      );
      return !covered;
    });
  // 点线也会被找线当成一条浅的线：和一串点重合的线不要。
  const lone = solid.filter(
    (r) =>
      !dots.some(
        (d) =>
          Math.abs(d.y + d.height / 2 - (r.y + r.height / 2)) <= 0.4 * lineHeight &&
          Math.min(d.x + d.width, r.x + r.width) - Math.max(d.x, r.x) > 0.5 * r.width,
      ),
  );
  // 填写处上面是空白的纸（深色底上、压着字的不是）。
  const blank = (f: FillIn) =>
    lightShare(image, {
      x: f.x,
      y: f.y - BLANK_ABOVE * lineHeight,
      width: f.width,
      height: 0.8 * BLANK_ABOVE * lineHeight,
    }) >= BLANK_SHARE;
  // 横线要是一条细线：浅色底纹的边找线时也会当成很浅的线（EU 样本 025 的账单表）。
  const inked = (f: FillIn) =>
    f.kind === 'dots' ||
    lineShare(image, { x: f.x, y: f.y, width: f.width, height: Math.max(1, f.height) }) >=
      RULE_INK_SHARE;
  return [...dots, ...lone].filter((f) => !inside(f) && blank(f) && inked(f));
}

/**
 * 和这条填写处同一排的字：填写处的底边落在字的下面三分之一到字下面不到一个行高之间
 * （在字的半腰的横线是压着标题的框边）。
 */
const sameRow = (l: OcrBox, f: Box, lineHeight: number) => {
  const base = f.y + f.height;
  return base >= l.y + 0.65 * l.height && base <= l.y + l.height + 0.8 * lineHeight;
};

/** 一串多长：按这一行的字号估，比原来的短一点。 */
function runOf(kind: FillIn['kind'], width: number, fontPx: number): string {
  const n = Math.max(4, Math.floor((width / (RUN_EM[kind] * fontPx)) * FILL_SLACK));
  return RUN_CHAR[kind].repeat(n);
}

/**
 * 把填写处接进识别行：在同一排、标签后面的接到标签那一行里（点在一行字中间的，替换掉识别读成的点、空格），
 * 一排里没有字的一串点自成一行。横线要有标签（左边同一排、不远），不然可能是分隔线，不要。
 * 返回新的行，和新行 → 原来的识别行（量笔画、颜色、下划线还是看原来的框）。
 */
export function withFillIns(
  input: readonly OcrBox[],
  fills: readonly FillIn[],
  lineHeight: number,
): { lines: OcrBox[]; source: Map<OcrBox, OcrBox> } {
  const source = new Map<OcrBox, OcrBox>();
  // 先去掉识别从点线里读出来的「...」「…」（落在点线上的点、空格）；整行都是这些的不要。
  const cleaned = input.flatMap((l): OcrBox[] => {
    const on = fills.filter(
      (f) =>
        f.kind === 'dots' &&
        sameRow(l, f, lineHeight) &&
        f.x < l.x + l.width &&
        f.x + f.width > l.x,
    );
    if (!on.length) return [l];
    const c = withoutLeader(l, on, lineHeight);
    if (c === l) return [l];
    if (c) source.set(c, l);
    return c ? [c] : [];
  });
  const lines = cleaned;
  const owned = new Map<OcrBox, FillIn[]>();
  const alone: FillIn[] = [];
  // 从左到右：同一排的第二条线接在已经接上第一条的标签后面。
  const reach = new Map<OcrBox, number>();
  const right = (l: OcrBox) => reach.get(l) ?? l.x + l.width;
  for (const f of [...fills].sort((a, b) => a.x - b.x)) {
    const row = lines.filter((l) => sameRow(l, f, lineHeight));
    // 点在一行字的框里（「od ……… do」），或者点线从字的末尾开始。
    // 横线只接在左边的标签后面（压着字的线上面已经去掉了）。
    let owner =
      f.kind === 'dots'
        ? row.find((l) => f.x > l.x && f.x + 0.5 * f.width > l.x && f.x < right(l))
        : undefined;
    if (!owner) {
      const left = row.filter(
        (l) =>
          right(l) <= f.x + 0.5 * lineHeight &&
          f.x - right(l) <= LABEL_GAP * lineHeight &&
          !row.some((m) => m !== l && m.x >= right(l) && m.x < f.x),
      );
      // 两行的标签：接在底边离填写处最近的那一行（横线画在第二行的底下）。
      const base = f.y + f.height;
      const far = (l: OcrBox) => Math.abs(l.y + l.height - base);
      owner = left.sort((a, b) => far(a) - far(b) || right(b) - right(a))[0];
    }
    if (owner) {
      owned.set(owner, [...(owned.get(owner) ?? []), f]);
      reach.set(owner, Math.max(right(owner), f.x + f.width));
    } else if (f.kind === 'dots' && !lines.some((l) => overlaps(l, f))) alone.push(f);
  }
  const out = lines.map((l) => {
    const mine = owned.get(l);
    if (!mine) return l;
    const merged = mergeFills(l, mine, lineHeight);
    source.set(merged, source.get(l) ?? l);
    return merged;
  });
  for (const f of alone) {
    const height = lineHeight;
    const text = runOf(f.kind, f.width, BOX_TO_FONT * height);
    out.push({
      text,
      x: f.x,
      y: f.y + f.height - 0.85 * height,
      width: f.width,
      height,
      chars: [...text].map((ch, i) => ({ text: ch, at: (i + 0.5) / text.length })),
    });
  }
  return { lines: out, source };
}

/** 一行的字（没有字的位置时按字数均匀分）。 */
const charsOf = (line: OcrBox) =>
  line.chars?.length === [...line.text].length
    ? line.chars
    : [...line.text].map((ch, i, all) => ({ text: ch, at: (i + 0.5) / all.length }));

/**
 * 哪些字是点线本身：落在点线上（前后宽出 0.3 个行高）的点、空格，再往两边连着的点、空格
 * （识别读出来的「...」常常比点线的头靠前一点）。
 */
function leaderChars(
  chars: readonly { x: number; text: string }[],
  fills: readonly FillIn[],
  lineHeight: number,
): boolean[] {
  const pad = 0.3 * lineHeight;
  const leader = chars.map((c) => LEADER_CHAR.test(c.text));
  const junk = chars.map(
    (c, i) => leader[i]! && fills.some((f) => c.x >= f.x - pad && c.x <= f.x + f.width + pad),
  );
  for (let i = 1; i < chars.length; i++) if (junk[i - 1] && leader[i]) junk[i] = true;
  for (let i = chars.length - 2; i >= 0; i--) if (junk[i + 1] && leader[i]) junk[i] = true;
  return junk;
}

/**
 * 去掉落在点线上的点、空格（识别读成的「...」）：框缩到剩下的字。剩下的没有字母、数字时 null，没有要去的时原样返回。
 */
function withoutLeader(line: OcrBox, fills: readonly FillIn[], lineHeight: number): OcrBox | null {
  const all = charsOf(line).map((c) => ({ ...c, x: line.x + c.at * line.width }));
  const junk = leaderChars(all, fills, lineHeight);
  const kept = all.filter((_, i) => !junk[i]);
  if (kept.length === all.length) return line;
  while (kept[0] && !kept[0].text.trim()) kept.shift();
  while (kept.at(-1) && !kept.at(-1)!.text.trim()) kept.pop();
  if (!kept.some((c) => /[\p{L}\p{N}]/u.test(c.text))) return null;
  const half = line.width / Math.max(1, all.length) / 2;
  // 只在去掉了字的那一头缩。
  const x = kept[0] === all[0] ? line.x : Math.max(line.x, kept[0]!.x - half);
  const end =
    kept.at(-1) === all.at(-1)
      ? line.x + line.width
      : Math.min(line.x + line.width, kept.at(-1)!.x + half);
  const width = end - x;
  return {
    ...line,
    text: kept.map((c) => c.text).join(''),
    x,
    width,
    chars: kept.map((c) => ({ text: c.text, at: (c.x - x) / width })),
  };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** 一行字和接在它里面、后面的几串填写处合成一行：框只往右伸，上下不变（字号按原来的行高算）。 */
function mergeFills(line: OcrBox, fills: readonly FillIn[], lineHeight: number): OcrBox {
  const fontPx = BOX_TO_FONT * line.height;
  const chars = charsOf(line);
  const end = line.x + line.width;
  const used = fills.filter((f) => f.width >= FILL_MIN * lineHeight);
  // 每个字在原图里的中心；落在点线里的点、空格是点线本身（识别读成的「...」），去掉。
  const placed = chars.map((c) => ({ x: line.x + c.at * line.width, text: c.text }));
  const junk = leaderChars(
    placed,
    used.filter((f) => f.kind === 'dots'),
    lineHeight,
  );
  const tokens: { x: number; text: string; fill?: FillIn }[] = placed.filter((_, i) => !junk[i]);
  for (const f of used) tokens.push({ x: f.x, text: runOf(f.kind, f.width, fontPx), fill: f });
  tokens.sort((a, b) => a.x - b.x);
  const x = Math.min(line.x, ...fills.map((f) => f.x));
  const width = Math.max(end, ...fills.map((f) => f.x + f.width)) - x;
  // 字之间照原样接；填写处前后各一个空格，它的字均匀铺满原来点线的位置（按列线切开时用）。
  const out: { text: string; at: number }[] = [];
  const space = (at: number) => {
    if (out.length && out.at(-1)!.text !== ' ') out.push({ text: ' ', at });
  };
  for (const tk of tokens) {
    if (tk.fill) {
      while (out.at(-1)?.text === ' ') out.pop();
      space((tk.x - x) / width);
      const n = tk.text.length;
      const w = tk.fill.x + tk.fill.width - tk.x;
      for (let i = 0; i < n; i++)
        out.push({ text: tk.text[i]!, at: (tk.x + ((i + 0.5) / n) * w - x) / width });
      space((tk.x + w - x) / width);
    } else if (tk.text.trim() || out.at(-1)?.text !== ' ') {
      out.push({ text: tk.text, at: (tk.x - x) / width });
    }
  }
  while (out[0]?.text === ' ') out.shift();
  while (out.at(-1)?.text === ' ') out.pop();
  return {
    ...line,
    text: out.map((c) => c.text).join(''),
    x,
    width,
    chars: out,
  };
}

/** 一块要填的底色：至少这么多个行高宽，占两段字中间空隙的这么多。 */
const BOX_MIN = 1.5;
const BOX_SHARE = 0.5;
/** 两段字中间的空隙最多这么多个行高。 */
const BOX_GAP_MAX = 12;
/** 空隙里一列算底色：这一列（行的中间那一截）至少这么多的点和底色差不多。 */
const BOX_FILLED = 0.85;
/** 和底色差多少以内（0–255，每个通道）算同一个颜色。 */
const BOX_TOLERANCE = 40;
/** 两段字底下有这么多是这个底色：字压在底纹上，不是空格。 */
const ON_FILL = 0.3;
/** 底色最多这么多个行高高：上下两行的空格对齐时会挨成一块（EU 样本 082），再高是整片的色块。 */
const BOX_MAX_HEIGHT = 2.3;
/** 比这更亮（每个通道都是）的是白纸，不是底色。 */
const PAPER = 235;

/**
 * 句子中间要填的地方是一块底色（合同模板里青色、灰色的空格，Word 的表单域打成 PDF，EU 样本 082）：识别在那里断开，
 * 一行成了好几段，后面一段还可能比第一段高一点、排序时跑到整段前面，或者几段被当成并排的几栏、几格。
 * 同一排、隔着这样一块底色的几段接成一行，底色那里写一串「_」（和横线的填写处一样，Word 里看得出要填）。
 * 底色只有一行高：整片的色块（栏的底色）上面隔开的两段不接。
 */
export function joinShadedBlanks(
  image: RgbaImage,
  input: readonly OcrBox[],
  lineHeight: number,
): { lines: OcrBox[]; source: Map<OcrBox, OcrBox> } {
  const source = new Map<OcrBox, OcrBox>();
  const { width, height, data } = image;
  const at = (x: number, y: number) => {
    const o =
      (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4;
    return [data[o]!, data[o + 1]!, data[o + 2]!] as const;
  };
  const paper = (c: readonly number[]) => c.every((v) => v >= PAPER);
  const near = (a: readonly number[], b: readonly number[]) =>
    a.every((v, i) => Math.abs(v - b[i]!) <= BOX_TOLERANCE);
  /** a、b 中间的空隙里有一块一行高的底色：返回它的左右边。 */
  const boxBetween = (a: OcrBox, b: OcrBox) => {
    const x0 = Math.ceil(a.x + a.width);
    const x1 = Math.floor(b.x);
    const gap = x1 - x0;
    if (gap < BOX_MIN * lineHeight || gap > BOX_GAP_MAX * lineHeight) return null;
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    const y0 = Math.round(top + 0.25 * (bottom - top));
    const y1 = Math.round(bottom - 0.25 * (bottom - top));
    if (y1 <= y0) return null;
    // 底色：空隙正中那一点的颜色（不是白纸）。
    const color = at(Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2));
    if (paper(color)) return null;
    let best: [number, number] | null = null;
    let start = -1;
    for (let x = x0; x <= x1; x++) {
      let n = 0;
      for (let y = y0; y < y1; y++) if (near(at(x, y), color)) n++;
      const filled = x < x1 && n >= BOX_FILLED * (y1 - y0);
      if (filled && start < 0) start = x;
      if (!filled && start >= 0) {
        if (!best || x - start > best[1] - best[0]) best = [start, x];
        start = -1;
      }
    }
    if (!best || best[1] - best[0] < Math.max(BOX_MIN * lineHeight, BOX_SHARE * gap)) return null;
    // 两段字本身在白纸上：字底下也是这个底色时，是整行的底纹（账单上一行一行的浅绿底，EU 样本 025），
    // 不是句子里要填的空格。
    const under = (l: OcrBox, from: number, to: number) => {
      let n = 0;
      let all = 0;
      for (let x = Math.round(from); x < Math.round(to); x += 2)
        for (let y = y0; y < y1; y++) {
          all++;
          if (near(at(x, y), color)) n++;
        }
      return all ? n / all : 0;
    };
    const reach = Math.min(2 * lineHeight, a.width, b.width);
    if (
      under(a, a.x + a.width - reach, a.x + a.width) > ON_FILL ||
      under(b, b.x, b.x + reach) > ON_FILL
    )
      return null;
    // 一行高：在底色的几处往上、往下量它有多高，取最矮的（上下两行的空格常常挨着，连成两行高；
    // 整片的色块哪里都高得多）。
    const cy = Math.round((y0 + y1) / 2);
    const limit = Math.ceil(BOX_MAX_HEIGHT * lineHeight);
    const tall = (x: number) => {
      let up = 0;
      while (up <= limit && near(at(x, cy - up - 1), color)) up++;
      let down = 0;
      while (down <= limit && near(at(x, cy + down + 1), color)) down++;
      return up + down + 1;
    };
    const span = best[1] - best[0];
    const heights = [0.1, 0.3, 0.5, 0.7, 0.9].map((k) => tall(Math.round(best![0] + k * span)));
    if (Math.min(...heights) > limit) return null;
    return best;
  };
  const sameRow = (a: OcrBox, b: OcrBox) =>
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >=
      0.6 * Math.min(a.height, b.height) &&
    Math.max(a.height, b.height) <= 2 * Math.min(a.height, b.height);
  const lines = [...input];
  const used = new Set<OcrBox>();
  const out: OcrBox[] = [];
  for (const first of [...lines].sort((a, b) => a.x - b.x)) {
    if (used.has(first)) continue;
    let line = first;
    // 和刚接上的那一段比（接起来的行比一个字「y」高得多）。
    let last = first;
    for (;;) {
      const right = last.x + last.width;
      const next = lines
        .filter((l) => !used.has(l) && l !== first && l.x >= right && sameRow(last, l))
        .sort((a, b) => a.x - b.x)[0];
      const box = next && boxBetween(last, next);
      if (!next || !box) break;
      used.add(next);
      line = joinAcross(line, next, box);
      last = next;
    }
    used.add(first);
    if (line !== first) source.set(line, first);
    out.push(line);
  }
  return { lines: out, source };
}

/** 两段字和中间的一块底色接成一行：底色那里一串「_」，后一段以标点开头时不空格。 */
function joinAcross(a: OcrBox, b: OcrBox, box: [number, number]): OcrBox {
  const x = a.x;
  const right = b.x + b.width;
  const w = right - x;
  const fontPx = BOX_TO_FONT * a.height;
  const run = runOf('rule', box[1] - box[0], fontPx);
  const place = (l: OcrBox) =>
    charsOf(l).map((c) => ({ text: c.text, at: (l.x + c.at * l.width - x) / w }));
  const chars = [
    ...place(a),
    { text: ' ', at: (a.x + a.width - x) / w },
    ...[...run].map((ch, i) => ({
      text: ch,
      at: (box[0] + ((i + 0.5) / run.length) * (box[1] - box[0]) - x) / w,
    })),
    ...(/^[.,;:)]/u.test(b.text) ? [] : [{ text: ' ', at: (box[1] - x) / w }]),
    ...place(b),
  ];
  const y = Math.min(a.y, b.y);
  return {
    ...a,
    text: chars.map((c) => c.text).join(''),
    x,
    y,
    width: w,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
    chars,
  };
}
