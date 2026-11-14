// 数字 PDF 的整图在本机剪出，跟随 Word 正文重排；页底只允许纯装饰。
// 字符串随固定的 pdfview 页面打包，不能依赖函数 toString（Metro 会插入运行时辅助函数）。
export const PDF_GRAPHICS_SCRIPT = String.raw`
const area = (b) => Math.max(0, b.width) * Math.max(0, b.height);
const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const covered = (a, b) => overlap(a, b) / Math.max(1, area(a));
// PDF.js 记录的路径（0 移动、1 直线、2/3 曲线、4 闭合）是什么形状：矩形、圆角矩形（四条边是横平竖直的直线、
// 四个角是曲线，例如信息卡片）、椭圆。
function pathShape(path, bounds) {
  let j = 0,
    curves = 0,
    lines = 0,
    closed = 0,
    bad = false,
    x = 0,
    y = 0,
    longest = 0,
    straight = 0,
    slanted = 0;
  while (j < path.length) {
    const op = path[j++];
    if (op === 0 || op === 1) {
      const nx = path[j++],
        ny = path[j++];
      if (op === 1) {
        lines++;
        longest = Math.max(longest, Math.hypot(nx - x, ny - y));
        if (Math.abs(nx - x) < 0.01 || Math.abs(ny - y) < 0.01) straight += Math.hypot(nx - x, ny - y);
        else slanted++;
      }
      x = nx;
      y = ny;
    } else if (op === 2) {
      j += 4;
      x = path[j++];
      y = path[j++];
      curves++;
    } else if (op === 3) {
      j += 2;
      x = path[j++];
      y = path[j++];
      curves++;
    } else if (op === 4) closed++;
    else {
      bad = true;
      break;
    }
  }
  const w = bounds ? bounds[2] - bounds[0] : 0,
    h = bounds ? bounds[3] - bounds[1] : 0;
  return {
    ellipse: !bad && curves >= 4 && closed > 0 && longest < Math.min(w, h) * 0.05,
    rectangle: !bad && curves === 0 && lines >= 3 && lines <= 4 && closed > 0,
    // 圆角只占边的一小段：四条横平竖直的边加起来至少是外框周长的一半（浏览器把每个圆角拆成好几段曲线）。
    rounded:
      !bad && curves > 0 && closed > 0 && lines >= 2 && lines <= 4 && !slanted &&
      straight >= (w + h) * 2 * 0.5,
  };
}
function mergeGraphicBoxes(boxes) {
  const result = [];
  for (const original of boxes) {
    let b = { ...original }, changed = true;
    while (changed) {
      changed = false;
      for (let i = result.length - 1; i >= 0; i--) {
        const old = result[i];
        if (overlap(b, old) < Math.min(area(b), area(old)) * 0.15) continue;
        const right = Math.max(b.x + b.width, old.x + old.width);
        const bottom = Math.max(b.y + b.height, old.y + old.height);
        b.x = Math.min(b.x, old.x); b.y = Math.min(b.y, old.y);
        b.width = right - b.x; b.height = bottom - b.y;
        result.splice(i, 1); changed = true;
      }
    }
    result.push(b);
  }
  return result.sort((a, b) => a.y - b.y || a.x - b.x);
}
function decorativeOperation(r, full) {
  const b = r.box;
  return b && area(b) >= area(full) * 0.65 &&
    (r.safeBackdrop || (!r.image && (r.rectangle || r.name === 'shadingFill') &&
      b.x <= full.width * 0.08 && b.y <= full.height * 0.08 &&
      b.x + b.width >= full.width * 0.92 && b.y + b.height >= full.height * 0.92));
}
// 画字的指令：没有 Unicode 的字形（text 是空串）也是字，不能当成绘图画进页底或图外的剪图。
const isTextOp = (r) => typeof r.text === 'string';
// 剪图那一遍画哪些指令：图里的字、透明字层画，图外的字不画；阴影蒙版下的绘图不画。
function cropOperation(r, plan) {
  if (!r) return false;
  if (isTextOp(r)) return plan.keep.has(r.i) || r.mode === 3;
  if (r.activeMask && plan.shadows.has(r.activeMask) && (r.name === 'constructPath' || r.image))
    return false;
  return true;
}
// 页底那一遍只画纯装饰：任何字都不画。
function backgroundOperation(r, full) {
  if (!r || isTextOp(r)) return false;
  if (r.name === 'constructPath' || r.image || r.name === 'shadingFill')
    return !!decorativeOperation(r, full);
  return true;
}
function padGraphicBoxes(boxes, lines, width, height) {
  // 绘图框和版面框都有边界误差；剪图留少量白边，但不能接管相邻正文。
  return boxes.map((b) => {
    let left = Math.max(0, b.x - width / 128), top = Math.max(0, b.y - height / 128);
    let right = Math.min(width, b.x + b.width + width / 128), bottom = Math.min(height, b.y + b.height + height / 128);
    for (const l of lines || []) {
      if (boxes.some((o) => covered(l, o) > 0.8)) continue;
      if (covered(l, { x: left, y: top, width: right - left, height: bottom - top }) < 0.4) continue;
      if (l.x < right && l.x + l.width > left) {
        if (l.y >= b.y + b.height) bottom = Math.min(bottom, l.y - 0.25);
        else if (l.y + l.height <= b.y) top = Math.max(top, l.y + l.height + 0.25);
        else { if (l.y < b.y) top = b.y; if (l.y + l.height > b.y + b.height) bottom = b.y + b.height; }
      }
      if (l.y < bottom && l.y + l.height > top) {
        if (l.x >= b.x + b.width) right = Math.min(right, l.x - 0.25);
        else if (l.x + l.width <= b.x) left = Math.max(left, l.x + l.width + 0.25);
        else { if (l.x < b.x) left = b.x; if (l.x + l.width > b.x + b.width) right = b.x + b.width; }
      }
    }
    return { x: Math.min(left, b.x), y: Math.min(top, b.y),
      width: Math.max(right, b.x + b.width) - Math.min(left, b.x),
      height: Math.max(bottom, b.y + b.height) - Math.min(top, b.y) };
  });
}
function completeBarcodes(ctx, width, height, boxes, scale, texts) {
  const pixels = ctx.getImageData(0, 0, width, height).data;
  return boxes.map((b) => {
    if (b.width < b.height * 3 || b.height * scale < 8 || b.height * scale > height * 0.08) return b;
    const top = Math.max(0, Math.ceil((b.y + 1) * scale));
    const bottom = Math.min(height, Math.floor((b.y + b.height - 1) * scale));
    const columns = [];
    for (let x = 0; x < width; x++) {
      let ink = 0;
      for (let y = top; y < bottom; y++) {
        const i = (y * width + x) * 4;
        if (pixels[i + 3] > 80 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 180) ink++;
      }
      columns.push(ink > (bottom - top) * 0.3);
    }
    const groups = [];
    let group;
    for (let x = 0; x < width; x++) if (columns[x]) {
      if (!group || x - group.end > Math.max(3, scale * 3)) {
        group = { start: x, end: x, transitions: 0 }; groups.push(group);
      }
      if (!columns[x - 1]) group.transitions++;
      group.end = x;
    }
    const candidate = groups.find((g) => g.transitions >= 12 &&
      Math.min(g.end / scale, b.x + b.width) - Math.max(g.start / scale, b.x) > b.width * 0.4 &&
      (g.end - g.start) / scale <= b.width * 2);
    if (!candidate) return b;
    const expanded = { ...b, x: Math.min(b.x, candidate.start / scale - 1),
      width: Math.max(b.x + b.width, candidate.end / scale + 1) - Math.min(b.x, candidate.start / scale - 1) };
    return texts.some((t) => covered(t.box, expanded) > 0.8 && covered(t.box, b) < 0.8) ? b : expanded;
  });
}
function planNativeGraphics(records, input) {
  const texts = records.filter((r) => r.text && r.alpha > 0.01 && r.mode !== 3 && r.box);
  if (texts.length > 4000) return null;
  const vertical = texts.filter((t) => t.text.trim().length >= 4 && t.box.height > 2 * t.box.width);
  if (
    input.width > input.height &&
    vertical.length >= 4 &&
    vertical.reduce((n, t) => n + t.text.length, 0) >=
      texts.reduce((n, t) => n + t.text.length, 0) * 0.7
  )
    return null;

  if (records.some((r) => r.text && r.mode >= 4)) return null; // 字体裁剪必须完整执行，不能偷偷把裁剪变成普通字。
  const rowsOf = (ts) => {
    const rows = [];
    for (const t of [...ts].sort((a, b) => a.box.y - b.box.y)) {
      const y = t.box.y + t.box.height / 2;
      if (!rows.some((r) => Math.abs(r.y - y) < Math.max(r.h, t.box.height) * 0.6))
        rows.push({ y, h: t.box.height });
    }
    return rows.length;
  };
  const full = { x: 0, y: 0, width: input.width, height: input.height };
  const owned = [...(input.figures || [])];
  // 狭长的原生位图若装着正文（如一整行目录），不能当作图的标签吞掉。
  if (
    records.some(
      (r) =>
        r.image &&
        r.box &&
        !r.mask &&
        r.box.width / r.box.height > 8 &&
        (input.lines || []).some(
          (l) => l.chars > 24 && l.width > input.width * 0.3 && covered(l, r.box) > 0.8,
        ) &&
        !(input.figures || []).some((b) => covered(r.box, b) > 0.8),
    )
  )
    return null;
  let nativeArtwork = false;
  const masks = new Map();
  for (const r of records)
    if (r.mask && r.image && r.box) {
      const share = texts.reduce((n, t) => n + overlap(t.box, r.box), 0) / Math.max(1, area(r.box));
      if (share >= 0.38 && area(r.box) < area(full) * 0.25) masks.set(r.mask, true);
    }
  for (const r of records) {
    if (!r.box || r.mask || (!r.image && !r.ellipse)) continue;
    const inside = texts.filter((t) => covered(t.box, r.box) >= 0.8);
    const chars = inside.reduce((n, t) => n + t.text.replace(/\s/g, '').length, 0);
    const letters =
      inside
        .map((t) => t.text)
        .join('')
        .match(/\p{L}/gu) || [];
    const badge =
      letters.length >= 8 &&
      letters.filter((c) => c === c.toUpperCase()).length >= letters.length * 0.9;
    // 全页扫描图、插着整段正文的图不能成为图像所有权，否则会把可编辑正文吞掉。
    if (
      r.image &&
      area(r.box) < area(full) * 0.7 &&
      r.box.width > 8 &&
      r.box.height > 8 &&
      chars < 180
    )
      owned.push(r.box);
    // 小图章里的两三行短字跟随图章；长句和只有年份的圆圈仍是正文。
    if (
      r.ellipse &&
      area(r.box) < area(full) * 0.08 &&
      ((rowsOf(inside) >= 2 && rowsOf(inside) <= 4 && badge) ||
        (r.fill && rowsOf(inside) === 1 && letters.length >= 3 && chars <= 16)) &&
      chars <= 48 &&
      inside.every((t) => t.text.length <= 24)
    ) {
      owned.push(r.box);
      nativeArtwork = true;
    }
  }
  // 页角的小型多色标记（例如三色旗）也独立保留；不把正文、表单色条当成图标。
  const marks = records.filter((r) => r.rectangle && r.fill && r.box &&
    r.box.y < full.height * 0.15 && r.box.x < full.width * 0.18 &&
    r.box.width < full.width * 0.08 && r.box.height < full.height * 0.04 &&
    r.box.width > 2 && r.box.height > 2 &&
    !texts.some((t) => overlap(t.box, r.box) > area(t.box) * 0.2));
  for (const seed of marks) {
    const group = marks.filter((r) => Math.abs(r.box.y - seed.box.y) < 3 &&
      Math.abs(r.box.x - seed.box.x) < full.width * 0.06);
    if (new Set(group.map((r) => r.color)).size < 2) continue;
    const x = Math.min(...group.map((r) => r.box.x)), y = Math.min(...group.map((r) => r.box.y));
    const right = Math.max(...group.map((r) => r.box.x + r.box.width));
    const bottom = Math.max(...group.map((r) => r.box.y + r.box.height));
    owned.push({ x, y, width: right - x, height: bottom - y }); nativeArtwork = true;
  }
  // 重复的小图卡：相同尺寸的填色矩形，跨两行两列，只有图内少量字母，标题在图外。
  const cards = records.filter(
    (r) =>
      r.rectangle &&
      r.fill &&
      r.box &&
      r.box.width > full.width * 0.08 &&
      r.box.height > full.height * 0.045 &&
      r.box.height >= r.box.width * 0.4 &&
      area(r.box) < area(full) * 0.12 &&
      texts
        .filter((t) => covered(t.box, r.box) > 0.8)
        .every((t) => /^[A-Z]{1,2}$/.test(t.text.trim())) &&
      texts
        .filter((t) => covered(t.box, r.box) > 0.8)
        .reduce((n, t) => n + t.text.trim().length, 0) <= 2,
  );
  for (const seed of cards) {
    const group = cards.filter(
      (r) =>
        Math.abs(r.box.width / seed.box.width - 1) < 0.08 &&
        Math.abs(r.box.height / seed.box.height - 1) < 0.08,
    );
    if (
      group.length >= 4 &&
      Math.max(...group.map((r) => r.box.x)) - Math.min(...group.map((r) => r.box.x)) >
        seed.box.width &&
      Math.max(...group.map((r) => r.box.y)) - Math.min(...group.map((r) => r.box.y)) >
        seed.box.height
    ) {
      nativeArtwork = true;
      owned.push(
        ...group
          .map((r) => r.box)
          .filter(
            (b) =>
              !owned.some(
                (o) => o.x === b.x && o.y === b.y && o.width === b.width && o.height === b.height,
              ),
          ),
      );
    }
  }
  // 有些标志连字都已转为路径。只接管小块、短行、没有原生正文字层的矢量标志。
  const labels = (input.lines || []).filter((l) => l.chars >= 3 && l.chars <= 32 &&
    !owned.some((b) => covered(l, b) > 0.8) &&
    !texts.some((t) => overlap(l, t.box) / Math.max(1, Math.min(area(l), area(t.box))) > 0.35));
  const labelGroups = [];
  for (const l of labels.sort((a, b) => a.y - b.y)) {
    const previous = labelGroups.find((g) => l.x < g.x + g.width && l.x + l.width > g.x &&
      l.y <= g.y + g.height + l.height * 2);
    if (previous) {
      const right = Math.max(previous.x + previous.width, l.x + l.width), bottom = Math.max(previous.y + previous.height, l.y + l.height);
      previous.x = Math.min(previous.x, l.x); previous.y = Math.min(previous.y, l.y);
      previous.width = right - previous.x; previous.height = bottom - previous.y; previous.chars += l.chars;
    } else labelGroups.push({ ...l });
  }
  for (const label of labelGroups) {
    if (label.chars > 100 || label.width > full.width * 0.22 || label.height > full.height * 0.18) continue;
    const h = Math.min(label.height, full.height * 0.025);
    const near = { x: label.x - h, y: label.y - h, width: label.width + h * 2, height: label.height + h * 2 };
    const paints = records.filter((r) => r.box && !r.text && !r.mask &&
      (r.name === 'constructPath' || r.image) && covered(r.box, near) > 0.8 &&
      area(r.box) < area(full) * 0.04);
    if (paints.length < 3) continue;
    const x = Math.max(0, Math.min(label.x, ...paints.map((r) => r.box.x)) - 1);
    const y = Math.max(0, Math.min(label.y, ...paints.map((r) => r.box.y)) - 1);
    const right = Math.min(full.width, Math.max(label.x + label.width, ...paints.map((r) => r.box.x + r.box.width)) + 1);
    const bottom = Math.min(full.height, Math.max(label.y + label.height, ...paints.map((r) => r.box.y + r.box.height)) + 1);
    const box = { x, y, width: right - x, height: bottom - y };
    if (texts.some((t) => overlap(t.box, box) > area(t.box) * 0.2)) continue;
    owned.push(box); nativeArtwork = true;
  }
  // 单色表格的灰底和边框已经由可编辑表格承载，不为它们再叠一张整页底图。
  // 独立图章/图卡、实质性的原生图像和彩色绘图才需要此路径。
  const chromatic = (c) =>
    /^[0-9A-F]{6}$/i.test(c || '') &&
    Math.max(...[0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16))) -
      Math.min(...[0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16))) >=
      24;
  // 模型找到了整幅示意图、原生图像证明其中确实有图时，把零散位图和矢量标签作为一张图。
  // 很大的表单区、长段正文和没有原生图像佐证的模型误报不接管。
  // 区域里图外面有一叠左对齐、一行接一行的字（信头的地址、「NOM : / Date de naissance : / Classe :」，
  // EU 样本 097）：那是框着的正文，不是图里零散的标注，区域不接管，只剪图自己。
  const textStack = (items) =>
    items.some((a) => {
      const column = items
        .filter((t) => Math.abs(t.box.x - a.box.x) <= Math.max(2, a.box.height * 0.3))
        .sort((p, q) => p.box.y - q.box.y);
      let run = 1;
      for (let k = 1; k < column.length; k++) {
        const gap = column[k].box.y - column[k - 1].box.y;
        run = gap > 0 && gap <= 2.5 * column[k - 1].box.height ? run + 1 : 1;
        if (run >= 4) return true;
      }
      return false;
    });
  for (const b of input.candidates || []) {
    const inside = texts.filter((t) => covered(t.box, b) > 0.8);
    if (area(b) < area(full) * 0.7 &&
        owned.some((o) => covered(o, b) > 0.8) &&
        inside.every((t) => t.text.trim().length <= 72) &&
        inside.reduce((n, t) => n + t.text.trim().length, 0) < 180) {
      if (!textStack(inside.filter((t) => !owned.some((o) => covered(t.box, o) > 0.8))))
        owned.push(b);
      nativeArtwork = true;
    }
  }
  const hasGraphic =
    nativeArtwork ||
    masks.size > 0 ||
    records.some(
      (r) =>
        r.box &&
        !r.mask &&
        (r.safeBackdrop ||
          (r.image && area(r.box) > area(full) * 0.015) ||
          (r.fill && chromatic(r.color) && area(r.box) > area(full) * 0.0005)),
    );
  if (!hasGraphic) return null;
  const keep = (t) => owned.some((b) => covered(t.box, b) > 0.8);
  const large = records.filter(
    (r) => r.image && r.box && !r.mask && area(r.box) > area(full) * 0.7,
  );
  if (large.some((r) => !r.safeBackdrop)) return null;
  // 已证明正文位置在位图中是纯底色：未被原生正文覆盖的少量短字属于这张绘图（例如图中品牌字）。
  if (large.length) {
    const labels = (input.lines || []).filter(
      (l) =>
        !texts.some((t) => overlap(l, t.box) / Math.max(1, Math.min(area(l), area(t.box))) > 0.35),
    );
    if (labels.some((l) => l.chars > 32) || labels.reduce((n, l) => n + l.chars, 0) > 160)
      return null;
    const groups = [];
    for (const l of labels) {
      let g = groups.find(
        (b) =>
          Math.abs(b.x + b.width / 2 - (l.x + l.width / 2)) < Math.max(b.width, l.width) &&
          l.y <= b.y + b.height + 2 * l.height &&
          l.y + l.height >= b.y - 2 * l.height,
      );
      if (g) {
        const right = Math.max(g.x + g.width, l.x + l.width),
          bottom = Math.max(g.y + g.height, l.y + l.height);
        g.x = Math.min(g.x, l.x);
        g.y = Math.min(g.y, l.y);
        g.width = right - g.x;
        g.height = bottom - g.y;
      } else groups.push({ ...l });
    }
    if (
      labels.reduce((n, l) => n + l.chars, 0) > 48 &&
      groups.some(
        (g) =>
          !owned.some(
            (b) =>
              Math.min(g.x + g.width, b.x + b.width) > Math.max(g.x, b.x) &&
              Math.max(0, g.y - b.y - b.height, b.y - g.y - g.height) <= 2 * g.height,
          ),
      )
    )
      return null;
    owned.push(
      ...groups.map((b) => ({ x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4 })),
    );
  }
  // 拼起来的整图下面压着成段的原生正文（斜着的「MUSTER」水印由几百条细位图拼成，EU 样本 071）：
  // 那是水印、底纹，不是图。接管了就把正文一起画进剪图、切掉跨出图边的字；不接管，字照常可编辑，水印不画。
  const merged = mergeGraphicBoxes(owned);
  const watermarks = merged.filter(
    (b) =>
      texts
        .filter((t) => covered(t.box, b) >= 0.8)
        .reduce((n, t) => n + t.text.replace(/\s/g, '').length, 0) >= 180,
  );
  owned.splice(0, owned.length, ...merged.filter((b) => !watermarks.includes(b)));
  const native = (l) =>
    texts.some((t) => overlap(l, t.box) / Math.max(1, Math.min(area(l), area(t.box))) > 0.35);
  // 水印自己的笔画被识别成的字（「XXxHXXXXI」）：在水印里，又没有原生字和它对得上。
  const ink = (l) => watermarks.some((b) => covered(l, b) > 0.8) && !native(l);
  const ocr = (input.lines || []).filter(
    (l) => !owned.some((b) => covered(l, b) > 0.8) && !ink(l),
  );
  const total = ocr.reduce((n, l) => n + l.chars, 0);
  const matched = ocr.reduce((n, l) => n + (native(l) ? l.chars : 0), 0);
  // 隐藏的 OCR 字层不算数字正文。混合扫描页不能叠一张含正文的扫描图。
  if (total && matched / total < 0.85) return null;
  return {
    owned,
    watermarks,
    // 识别行里哪些是水印的笔画（按传进来的 lines 的序号），转 Word 时不当字。
    watermarkInk: (input.lines || []).flatMap((l, k) => (ink(l) ? [k] : [])),
    // 图里的字（连同没有 Unicode 的字形）跟着剪图画。
    keep: new Set(
      records
        .filter((r) => isTextOp(r) && r.box && r.alpha > 0.01 && r.mode !== 3 && keep(r))
        .map((r) => r.i),
    ),
    shadows: new Set(masks.keys()),
    // 没画进剪图的字：Word 里按它写颜色；图里和它重叠的识别行也留作正文（不归图）。
    colors: texts.filter((t) => !keep(t)).map((t) => ({ box: t.box, color: t.color })),
    // 圆角的信息卡片也是字下面的底色：不进页底（只画整页装饰），只能随段落、格子的底色保留。
    // 半透明的底色（20% 的品牌色，EU 样本 048）按它在白纸上看起来的浅色写，不写成不透明的深色。
    fills: records.filter((r) => r.fill && (r.rectangle || r.rounded) && r.box && r.alpha >= 0.05 && !r.mask)
      .map((r) => ({ box: r.box, color: r.alpha > 0.9 ? r.color : onWhite(r.color, r.alpha) })),
  };
}
/** 半透明的颜色（RRGGBB，不透明度 alpha）叠在白纸上的颜色。 */
function onWhite(color, alpha) {
  if (!/^[0-9A-F]{6}$/i.test(color)) return color;
  return [0, 2, 4]
    .map((k) => Math.round(255 - alpha * (255 - parseInt(color.slice(k, k + 2), 16))))
    .map((v) => v.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
}
handlers.graphics = async ({ file, index, maxSide, figures, candidates, lines }) => {
  const doc = await open(file);
  const canvas = document.createElement('canvas');
  try {
    const p = await lib();
    if (p.version !== '6.4.299') return { applicable: false };
    const page = await doc.getPage(index + 1),
      base = page.getViewport({ scale: 1 });
    const scale = Math.min(
      (maxSide || 2000) / Math.max(base.width, base.height),
      Math.sqrt(MAX_PIXELS / (base.width * base.height)),
    );
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    const names = Object.fromEntries(Object.entries(p.OPS).map(([k, v]) => [v, k]));
    let state = { color: '000000', alpha: 1, mode: 0, smask: null },
      stack = [],
      groups = [],
      lastMask = null,
      maskId = 0;
    const records = [];
    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      recordOperations: true,
      operationsFilter(i, ops) {
        if (records.length > 100000) throw new Error('PDF graphics too complex');
        const name = names[ops.fnArray[i]],
          args = ops.argsArray[i];
        if (name === 'save') stack.push({ ...state });
        else if (name === 'restore') state = stack.pop() || state;
        else if (name === 'beginGroup') {
          // 透明组整组按开组时的不透明度叠上去（Illustrator 存的 20% 色块：外面 /ca 0.2，组里 /ca 1）。
          groups.push({
            state: { ...state },
            mask: args[0]?.smask ? 'mask' + ++maskId : null,
            alpha: state.alpha * (groups.at(-1)?.alpha ?? 1),
          });
          state = { ...state, alpha: 1, smask: null };
        } else if (name === 'endGroup') {
          const g = groups.pop();
          if (g) {
            lastMask = g.mask;
            state = g.state;
          }
        } else if (name === 'setFillRGBColor')
          state.color = String(args[0]).replace('#', '').toUpperCase();
        else if (name === 'setTextRenderingMode') state.mode = args[0];
        else if (name === 'setGState')
          for (const [k, v] of args[0]) {
            if (k === 'ca') state.alpha = v;
            if (k === 'SMask') state.smask = v ? lastMask : null;
          }
        const rec = {
          i,
          name,
          alpha: state.alpha * (groups.at(-1)?.alpha ?? 1),
          mode: state.mode,
          color: state.color,
          activeMask: state.smask,
          mask: groups.map((g) => g.mask).find(Boolean) || null,
        };
        if (/^(showText|showSpacedText|nextLineShowText|nextLineSetSpacingShowText)$/.test(name))
          rec.text = args
            .flat(Infinity)
            .filter((x) => x && typeof x.unicode === 'string')
            .map((x) => x.unicode)
            .join('');
        if (/^paint.*Image/.test(name)) {
          rec.image = true;
          if (name === 'paintImageXObject') rec.imageId = args[0];
        }
        if (name === 'constructPath') {
          rec.fill = [p.OPS.fill, p.OPS.eoFill, p.OPS.fillStroke, p.OPS.eoFillStroke].includes(
            args[0],
          );
          const path = args[1]?.[0];
          if (path && typeof path.length === 'number') Object.assign(rec, pathShape(path, args[2]));
        }
        records.push(rec);
        return true;
      },
    }).promise;
    const bb = page.recordedBBoxes;
    if (!bb) return { applicable: false };
    for (const r of records)
      if (!bb.isEmpty(r.i))
        r.box = {
          x: bb.minX(r.i) * base.width,
          y: bb.minY(r.i) * base.height,
          width: (bb.maxX(r.i) - bb.minX(r.i)) * base.width,
          height: (bb.maxY(r.i) - bb.minY(r.i)) * base.height,
        };
    // 大位图可能是纸的装饰底图，也可能是扫描正文。只在每一处原生正文下都是平坦底色时允许前者。
    const visible = records.filter((r) => r.text && r.box && r.alpha > 0.01 && r.mode !== 3);
    for (const r of records.filter(
      (r) => r.imageId && r.box && !r.mask && area(r.box) > base.width * base.height * 0.7,
    )) {
      const im = page.objs.get(r.imageId),
        sample = document.createElement('canvas');
      try {
        if (!im.bitmap) continue;
        const k = Math.min(1, 1600 / Math.max(im.width, im.height));
        sample.width = Math.max(1, Math.round(im.width * k));
        sample.height = Math.max(1, Math.round(im.height * k));
        const sc = sample.getContext('2d');
        sc.drawImage(im.bitmap, 0, 0, sample.width, sample.height);
        const bytes = sc.getImageData(0, 0, sample.width, sample.height).data;
        let total = 0,
          flat = 0;
        for (const t of visible) {
          const n = t.text.replace(/\s/g, '').length;
          if (!n) continue;
          total += n;
          const a = t.box,
            x0 = Math.max(0, Math.floor(((a.x - r.box.x) / r.box.width) * sample.width)),
            x1 = Math.min(
              sample.width,
              Math.ceil(((a.x + a.width - r.box.x) / r.box.width) * sample.width),
            ),
            y0 = Math.max(0, Math.floor(((a.y - r.box.y) / r.box.height) * sample.height)),
            y1 = Math.min(
              sample.height,
              Math.ceil(((a.y + a.height - r.box.y) / r.box.height) * sample.height),
            );
          const values = [];
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const j = (y * sample.width + x) * 4;
              values.push(Math.round((bytes[j] + bytes[j + 1] + bytes[j + 2]) / 3));
            }
          values.sort((a, b) => a - b);
          if (
            values.length &&
            values[Math.floor(values.length * 0.98)] - values[Math.floor(values.length * 0.02)] < 12
          )
            flat += n;
        }
        r.safeBackdrop = total >= 40 && flat / total >= 0.98;
      } finally {
        sample.width = sample.height = 0;
      }
    }
    const plan = planNativeGraphics(records, {
      width: base.width,
      height: base.height,
      figures,
      candidates,
      lines,
    });
    if (!plan) return { applicable: false };
    const byIndex = new Map(records.map((r) => [r.i, r]));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      background: 'rgba(0,0,0,0)',
      operationsFilter: (i) => cropOperation(byIndex.get(i), plan),
    }).promise;
    // 每张图单独输出。完整绘图层只在此处作剪图中间值，绝不作为文字/表格后面的固定内容层。
    plan.owned = completeBarcodes(ctx, canvas.width, canvas.height, plan.owned, scale,
      visible.filter((t) => !plan.keep.has(t.i)));
    plan.owned = padGraphicBoxes(plan.owned, lines, base.width, base.height);
    const crops = plan.owned.map((box) => {
      const crop = document.createElement('canvas');
      const x = Math.max(0, Math.floor(box.x * scale)), y = Math.max(0, Math.floor(box.y * scale));
      crop.width = Math.max(1, Math.min(canvas.width - x, Math.ceil(box.width * scale)));
      crop.height = Math.max(1, Math.min(canvas.height - y, Math.ceil(box.height * scale)));
      crop.getContext('2d').drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      const result = { box, width: crop.width, height: crop.height, png: crop.toDataURL('image/png').split(',')[1] };
      crop.width = crop.height = 0;
      return result;
    });
    const full = { x: 0, y: 0, width: base.width, height: base.height };
    let backgroundPng;
    if (records.some((r) => decorativeOperation(r, full))) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport, background: 'rgba(0,0,0,0)',
        operationsFilter: (i) => backgroundOperation(byIndex.get(i), full),
      }).promise;
      for (const b of plan.owned) ctx.clearRect(b.x * scale, b.y * scale, b.width * scale, b.height * scale);
      backgroundPng = canvas.toDataURL('image/png').split(',')[1];
    }
    return {
      applicable: true,
      paper: { width: base.width, height: base.height },
      width: canvas.width,
      height: canvas.height,
      crops,
      backgroundPng,
      owned: plan.owned,
      watermarks: plan.watermarks,
      watermarkInk: plan.watermarkInk,
      colors: plan.colors,
      fills: plan.fills,
    };
  } finally {
    canvas.width = canvas.height = 0;
    await doc.close();
  }
};
`;
