// 数字 PDF 的原始绘图只在本机拆成底图；正文仍由 Word 的段落和表格承载。
// 字符串随固定的 pdfview 页面打包，不能依赖函数 toString（Metro 会插入运行时辅助函数）。
export const PDF_GRAPHICS_SCRIPT = String.raw`
const area = (b) => Math.max(0, b.width) * Math.max(0, b.height);
const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const covered = (a, b) => overlap(a, b) / Math.max(1, area(a));
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
      rowsOf(inside) >= 2 &&
      rowsOf(inside) <= 4 &&
      badge &&
      chars <= 48 &&
      inside.every((t) => t.text.length <= 24)
    ) {
      owned.push(r.box);
      nativeArtwork = true;
    }
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
  // 单色表格的灰底和边框已经由可编辑表格承载，不为它们再叠一张整页底图。
  // 独立图章/图卡、实质性的原生图像和彩色绘图才需要此路径。
  const chromatic = (c) =>
    /^[0-9A-F]{6}$/i.test(c || '') &&
    Math.max(...[0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16))) -
      Math.min(...[0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16))) >=
      24;
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
  const ocr = (input.lines || []).filter((l) => !owned.some((b) => covered(l, b) > 0.8));
  const total = ocr.reduce((n, l) => n + l.chars, 0);
  const matched = ocr.reduce(
    (n, l) =>
      n +
      (texts.some((t) => overlap(l, t.box) / Math.max(1, Math.min(area(l), area(t.box))) > 0.35)
        ? l.chars
        : 0),
    0,
  );
  // 隐藏的 OCR 字层不算数字正文。混合扫描页不能叠一张含正文的扫描图。
  if (total && matched / total < 0.85) return null;
  return {
    owned,
    keep: new Set(texts.filter(keep).map((t) => t.i)),
    shadows: new Set(masks.keys()),
    colors: texts.filter((t) => !keep(t)).map((t) => ({ box: t.box, color: t.color })),
  };
}
handlers.graphics = async ({ file, index, maxSide, figures, lines }) => {
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
          groups.push({ state: { ...state }, mask: args[0]?.smask ? 'mask' + ++maskId : null });
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
          alpha: state.alpha,
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
          if (path && typeof path.length === 'number') {
            let j = 0,
              curves = 0,
              lines = 0,
              closed = 0,
              bad = false,
              x = 0,
              y = 0,
              longest = 0;
            while (j < path.length) {
              const op = path[j++];
              if (op === 0 || op === 1) {
                const nx = path[j++],
                  ny = path[j++];
                if (op === 1) {
                  lines++;
                  longest = Math.max(longest, Math.hypot(nx - x, ny - y));
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
            const bounds = args[2],
              shortSide = bounds ? Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]) : 0;
            rec.ellipse = !bad && curves >= 4 && closed > 0 && longest < shortSide * 0.05;
            rec.rectangle = !bad && curves === 0 && lines >= 3 && lines <= 4 && closed > 0;
          }
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
      operationsFilter(i) {
        const r = byIndex.get(i);
        if (!r) return false;
        if (r.text) return plan.keep.has(i) || r.mode === 3;
        if (
          r.activeMask &&
          plan.shadows.has(r.activeMask) &&
          (r.name === 'constructPath' || r.image)
        )
          return false;
        return true;
      },
    }).promise;
    return {
      applicable: true,
      paper: { width: base.width, height: base.height },
      width: canvas.width,
      height: canvas.height,
      png: canvas.toDataURL('image/png').split(',')[1],
      owned: plan.owned,
      colors: plan.colors,
    };
  } finally {
    canvas.width = canvas.height = 0;
    await doc.close();
  }
};
`;
