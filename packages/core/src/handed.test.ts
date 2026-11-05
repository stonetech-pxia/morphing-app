import { describe, expect, it } from 'vitest';

import {
  HANDED_FILES_MAX,
  attachmentField,
  attachmentIdsOfRecords,
  attachmentType,
  fieldHandedText,
  fieldHandsTo,
  handedFilesFor,
  pickHandedFiles,
  type AttachmentInfo,
} from './handed';
import type { Collection, Field } from './schema';
import { registry } from './test-helpers';

// 容器把记录里的字段交给工具（D-428、D-442）：字段给什么类型的值、附件里哪些文件能交给第一步。

const action = (id: string) => registry.actions.get(id)!;
const info = (id: string, name: string, mimeType: string, size = 10): AttachmentInfo => ({
  id,
  name,
  mimeType,
  size,
});

describe('what kind of value a field hands over', () => {
  const f = (type: string, extra: object = {}) => ({ id: 'x', name: 'X', type, ...extra }) as Field;

  it('text-like and number-like fields hand over text; an attachment field hands over files', () => {
    for (const type of ['text', 'note', 'number', 'money', 'date', 'datetime', 'time'])
      expect(fieldHandsTo(f(type))).toBe('text');
    expect(fieldHandsTo(f('file'))).toBe('files');
  });

  it('fields computed from others, links and checkboxes hand over nothing', () => {
    for (const type of ['formula', 'lookup', 'rollup', 'previous', 'link', 'checkbox'])
      expect(fieldHandsTo(f(type))).toBeNull();
  });

  it('the text of a value is what the entry shows, trimmed; nothing for an empty value', () => {
    expect(fieldHandedText(f('text'), '  hello ', 'en')).toBe('hello');
    expect(fieldHandedText(f('text'), '   ', 'en')).toBe('');
    expect(fieldHandedText(f('text'), undefined, 'en')).toBe('');
    expect(fieldHandedText(f('number'), 12.5, 'en')).toBe('12.5');
    expect(fieldHandedText(f('number'), undefined, 'en')).toBe('');
    expect(fieldHandedText(f('date'), '2026-11-05', 'en')).not.toBe('');
    // 附件字段不是文字。
    expect(fieldHandedText(f('file'), ['a'], 'en')).toBe('');
  });
});

describe('what kind of file an attachment is', () => {
  it('goes by the mime type, then by the file name when the mime type says nothing', () => {
    expect(attachmentType(info('a', 'x.jpg', 'image/jpeg'))).toBe('images');
    expect(attachmentType(info('a', 'x.pdf', 'application/pdf'))).toBe('pdf');
    expect(attachmentType(info('a', 'x.mp4', 'video/mp4'))).toBe('video');
    expect(attachmentType(info('a', 'x.m4a', 'audio/mp4'))).toBe('audio');
    expect(attachmentType(info('a', 'x.zip', 'application/zip'))).toBe('zip');
    expect(attachmentType(info('a', 'Scan.PDF', 'application/octet-stream'))).toBe('pdf');
    expect(attachmentType(info('a', 'photo.heic', 'application/octet-stream'))).toBe('images');
    expect(attachmentType(info('a', 'report.docx', 'application/octet-stream'))).toBe('files');
    expect(attachmentType(info('a', 'noext', ''))).toBe('files');
  });
});

describe('which attachments the first step takes', () => {
  const pdf = info('p1', 'a.pdf', 'application/pdf');
  const pdf2 = info('p2', 'b.pdf', 'application/pdf');
  const img = info('i1', 'a.jpg', 'image/jpeg');
  const doc = info('d1', 'a.docx', 'application/octet-stream');

  it('hands over only the files the step accepts, in the attachment order', () => {
    expect(pickHandedFiles(action('pdf.compress'), [pdf, img, pdf2])).toEqual({
      fileType: 'pdf',
      assetIds: ['p1', 'p2'],
    });
    expect(pickHandedFiles(action('image.resize'), [pdf, img, pdf2])).toEqual({
      fileType: 'images',
      assetIds: ['i1'],
    });
  });

  it('shows nothing when no attachment fits, or there are none', () => {
    expect(pickHandedFiles(action('image.resize'), [pdf, pdf2])).toBeNull();
    expect(pickHandedFiles(action('pdf.compress'), [])).toBeNull();
  });

  it('a step taking any file gets them all, whatever they are', () => {
    const picked = pickHandedFiles(action('file.save'), [pdf, img, doc]);
    expect(picked).toEqual({ fileType: 'files', assetIds: ['p1', 'i1', 'd1'] });
  });

  it('a step taking any file but only one kind present keeps that kind', () => {
    expect(pickHandedFiles(action('file.save'), [pdf, pdf2])).toEqual({
      fileType: 'pdf',
      assetIds: ['p1', 'p2'],
    });
  });

  it('a step that does not take the other kinds leaves them out (a Word file is not a PDF)', () => {
    // pdf.merge takes any file but video and audio: a clip is left out, the rest go.
    const clip = info('v1', 'a.mp4', 'video/mp4');
    expect(pickHandedFiles(action('pdf.merge'), [clip, pdf, img])?.assetIds).toEqual(['p1', 'i1']);
    expect(pickHandedFiles(action('pdf.compress'), [doc, pdf])).toEqual({
      fileType: 'pdf',
      assetIds: ['p1'],
    });
  });
});

describe('attachments of a table', () => {
  const table: Collection = {
    id: 'docs',
    name: 'Docs',
    fields: [
      { id: 'title', name: 'Title', type: 'text' },
      { id: 'scan', name: 'Scan', type: 'file' },
      { id: 'other', name: 'Other', type: 'file' },
    ],
  };
  const rec = (id: string, values: Record<string, unknown>) =>
    ({ id, collectionId: 'docs', values, createdAt: 1, updatedAt: 1 }) as never;

  it('a named field must be an attachment field; without a name it is the first one', () => {
    expect(attachmentField(table, 'scan')?.id).toBe('scan');
    expect(attachmentField(table, 'title')).toBeUndefined();
    expect(attachmentField(table, 'gone')).toBeUndefined();
    expect(attachmentField(table)?.id).toBe('scan');
    expect(attachmentField({ ...table, fields: [table.fields[0]!] })).toBeUndefined();
  });

  it('collects the ids of the first attachment field over all entries, without repeats', () => {
    const records = [
      rec('r1', { scan: ['a', 'b'], other: ['z'] }),
      rec('r2', { scan: 'c' }),
      rec('r3', {}),
      rec('r4', { scan: ['b', 'd'] }),
    ];
    expect(attachmentIdsOfRecords(table, records)).toEqual(['a', 'b', 'c', 'd']);
    expect(attachmentIdsOfRecords({ ...table, fields: [table.fields[0]!] }, records)).toEqual([]);
  });

  it('a record block hands over the fitting attachments and says which table they are from', () => {
    const records = [rec('r1', { scan: ['p1', 'i1'] })];
    const infos = new Map([
      ['p1', info('p1', 'a.pdf', 'application/pdf')],
      ['i1', info('i1', 'a.jpg', 'image/jpeg')],
    ]);
    expect(handedFilesFor(action('pdf.compress'), table, records, infos)).toEqual({
      type: 'attachments',
      fileType: 'pdf',
      assetIds: ['p1'],
      name: 'Scan',
    });
  });

  it('files that are not on this device any more (no info) are skipped; none left means no hand-over', () => {
    const records = [rec('r1', { scan: ['gone'] })];
    expect(handedFilesFor(action('pdf.compress'), table, records, new Map())).toBeNull();
  });

  it('the limit is the number of attachments one entry can hold', () => {
    expect(HANDED_FILES_MAX).toBe(20);
  });
});
