import { PDFDocument, degrees } from 'pdf-lib';

import { PdfError, assertPageIndices, loadPdf } from './core';
import { normalizeRotation, pageView } from './view';

// 页面操作：信息、抽取 / 删除 / 重排、旋转、拆分，以及符号化的页面规则。
// 所有页码下标都是 0 起；只有 range 字符串是给人看的 1 起页码。

export interface PageInfo {
  /** 用户看到的宽高（已考虑旋转），单位 pt。 */
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

export async function pageInfo(bytes: Uint8Array): Promise<PageInfo[]> {
  const doc = await loadPdf(bytes);
  return doc.getPages().map((page) => {
    const { width, height, rotation } = pageView(page);
    return { width, height, rotation };
  });
}

/** 把指定页按顺序复制到新文档。空列表或重复页返回 badRange。 */
async function copyPagesToNew(src: PDFDocument, indices: readonly number[]): Promise<Uint8Array> {
  assertPageIndices(indices, src.getPageCount());
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(src, [...indices])) out.addPage(page);
  return out.save();
}

/**
 * 新 PDF 只含 indices 指定的页，按给定顺序：可用于抽取、删除（传剩下的页）、重排。
 * 不允许重复页。新文档不保留书签和表单。
 */
export async function selectPages(
  bytes: Uint8Array,
  indices: readonly number[],
): Promise<Uint8Array> {
  return copyPagesToNew(await loadPdf(bytes), indices);
}

/** 在现有旋转角上顺时针再转 rotation 度；不传 indices 时旋转全部页。 */
export async function rotatePages(
  bytes: Uint8Array,
  rotation: 90 | 180 | 270,
  indices?: readonly number[],
): Promise<Uint8Array> {
  if (rotation !== 90 && rotation !== 180 && rotation !== 270) throw new PdfError('badOption');
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const targets = indices ?? doc.getPageIndices();
  assertPageIndices(targets, pages.length);
  for (const i of targets) {
    const page = pages[i];
    if (page) page.setRotation(degrees(normalizeRotation(page.getRotation().angle + rotation)));
  }
  return doc.save();
}

/** every：每 n 页一份；ranges：每个内层数组是一份的 0 起页码（规则同 selectPages）。 */
export type SplitMode = { kind: 'every'; n: number } | { kind: 'ranges'; ranges: number[][] };

export async function splitPdf(bytes: Uint8Array, mode: SplitMode): Promise<Uint8Array[]> {
  const src = await loadPdf(bytes);
  const count = src.getPageCount();
  let parts: number[][];
  if (mode.kind === 'every') {
    if (!Number.isInteger(mode.n) || mode.n < 1) throw new PdfError('badOption');
    parts = [];
    for (let start = 0; start < count; start += mode.n) {
      parts.push(src.getPageIndices().slice(start, start + mode.n));
    }
  } else {
    if (mode.ranges.length < 1) throw new PdfError('badRange');
    parts = mode.ranges;
  }
  const out: Uint8Array[] = [];
  for (const part of parts) out.push(await copyPagesToNew(src, part));
  return out;
}

/** AI 只能选择符号化规则（看不到文档内容），由这里换算成具体页码。 */
export type PageRule = 'all' | 'odd' | 'even' | 'first' | 'last' | { range: string };

const MAX_RANGE_LENGTH = 1000;

/**
 * 规则 → 0 起页码。odd / even 指人类页码（第 1、3、5… 页为 odd）。
 * range 形如 "1-3, 5, 8-"（1 起；"8-" 到末页，"-3" 从首页起），按书写顺序输出并去重。
 * 越界、倒序区间、无法解析或结果为空都返回 badRange。
 */
export function resolvePageRule(rule: PageRule, pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 0) throw new PdfError('badRange');
  const all = Array.from({ length: pageCount }, (_, i) => i);
  let result: number[];
  if (rule === 'all') result = all;
  else if (rule === 'odd') result = all.filter((i) => i % 2 === 0);
  else if (rule === 'even') result = all.filter((i) => i % 2 === 1);
  else if (rule === 'first') result = all.slice(0, 1);
  else if (rule === 'last') result = all.slice(-1);
  else if (typeof rule === 'object' && rule !== null && typeof rule.range === 'string') {
    result = parseRange(rule.range, pageCount);
  } else throw new PdfError('badRange');
  if (result.length < 1) throw new PdfError('badRange');
  return result;
}

function parseRange(text: string, pageCount: number): number[] {
  if (text.length > MAX_RANGE_LENGTH) throw new PdfError('badRange');
  const seen = new Set<number>();
  const result: number[] = [];
  // 归一化：中英文逗号 / 分号分隔，各种横线与波浪号都当作 "-"，忽略空白。
  for (const raw of text.split(/[,，;；]/)) {
    const token = raw.replace(/\s/g, '').replace(/[–—~～]/g, '-');
    if (token === '') continue;
    const parts = token.split('-');
    if (parts.length > 2) throw new PdfError('badRange');
    const [left = '', right] = parts;
    const start = left === '' && right !== undefined ? 1 : parsePage(left);
    const end = right === undefined ? start : right === '' ? pageCount : parsePage(right);
    if (start < 1 || start > end || end > pageCount) throw new PdfError('badRange');
    for (let page = start; page <= end; page++) {
      if (!seen.has(page)) {
        seen.add(page);
        result.push(page - 1);
      }
    }
  }
  return result;
}

function parsePage(text: string): number {
  if (!/^\d{1,6}$/.test(text)) throw new PdfError('badRange');
  return Number(text);
}
