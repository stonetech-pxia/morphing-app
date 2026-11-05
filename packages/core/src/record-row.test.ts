import { describe, expect, it } from 'vitest';

import type { AttachmentInfo } from './handed';
import { recordRowButtons, recordRowValue, recordsValue, runsInline } from './record-row';
import { quickActionsOf, type Collection, type QuickAction, type Workflow } from './schema';
import { initialParams } from './workflow/check';
import { registry, workspace } from './test-helpers';
import { findWorkflow } from './workflows/presets';

// 记录页顶部的按钮（D-428）：有哪些由表上的 recordRow 决定，值空的、对不上的不出现。

const quickActions = () => quickActionsOf(workspace('en'));

const table = (recordRow: Collection['recordRow']): Collection => ({
  id: 'people',
  name: 'People',
  fields: [
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'mobile', name: 'Mobile', type: 'text', format: 'phone' },
    { id: 'office', name: 'Office', type: 'text', format: 'phone' },
    { id: 'mail', name: 'Email', type: 'text', format: 'email' },
    { id: 'site', name: 'Site', type: 'text', format: 'url' },
    { id: 'note', name: 'Note', type: 'note' },
  ],
  ...(recordRow ? { recordRow } : {}),
});

const buttons = (t: Collection, values: Record<string, unknown>) =>
  recordRowButtons(t, quickActions(), registry, 'en', values);
const keys = (t: Collection, values: Record<string, unknown>) =>
  buttons(t, values).map((b) => b.key);

describe('which buttons show on an entry', () => {
  it('a table without recordRow has no row, whatever the values', () => {
    expect(keys(table(undefined), { name: 'A', mobile: '123456' })).toEqual([]);
  });

  it('follows the configured order', () => {
    const t = table([
      { tool: 'record-vcard' },
      { tool: 'record-email', field: 'mail' },
      { tool: 'record-call', field: 'mobile' },
    ]);
    expect(keys(t, { name: 'A', mobile: '123456', mail: 'a@b.com' })).toEqual([
      'record-vcard',
      'record-email-mail',
      'record-call-mobile',
    ]);
  });

  it('an empty or invalid value hides its button; the others stay', () => {
    const t = table([
      { tool: 'record-call', field: 'mobile' },
      { tool: 'record-message', field: 'mobile' },
      { tool: 'record-email', field: 'mail' },
      { tool: 'record-website', field: 'site' },
    ]);
    expect(keys(t, { mobile: '', mail: 'not mail', site: 'javascript:alert(1)' })).toEqual([]);
    expect(keys(t, { mobile: '分机 123', mail: 'a@b.com', site: '  ' })).toEqual([
      'record-email-mail',
    ]);
  });

  it('a button named for a phone step on a field without that format stays hidden', () => {
    const t = table([{ tool: 'record-call', field: 'name' }]);
    expect(keys(t, { name: '123456' })).toEqual([]);
  });

  it('several phone fields: each button carries its own number and says which field', () => {
    const t = table([
      { tool: 'record-call', field: 'mobile' },
      { tool: 'record-call', field: 'office' },
    ]);
    const shown = buttons(t, { mobile: '111 222', office: '333 444' });
    expect(shown.map((b) => [b.text, b.field?.name, b.showField])).toEqual([
      ['111 222', 'Mobile', true],
      ['333 444', 'Office', true],
    ]);
  });

  it('a tool taking text on any text field shows when it has a value', () => {
    const t = table([{ tool: 'record-copy', field: 'note' }]);
    expect(keys(t, {})).toEqual([]);
    expect(buttons(t, { note: 'hi' })[0]).toMatchObject({ text: 'hi', showField: false });
  });

  it('share vCard hides when the entry has nothing for a card', () => {
    const t = table([{ tool: 'record-vcard' }]);
    expect(keys(t, {})).toEqual([]);
    expect(keys(t, { name: 'A' })).toEqual(['record-vcard']);
  });

  it('a reference that does not exist or does not take a value shows nothing', () => {
    const t = table([{ tool: 'gone' }, { tool: 'scan-document' }]);
    expect(keys(t, { name: 'A' })).toEqual([]);
  });
});

describe('what a button hands over', () => {
  const record = {
    id: 'r',
    collectionId: 'people',
    values: { name: 'A' },
    createdAt: 1,
    updatedAt: 1,
  };
  it('a value tool gives the text of its field, trimmed', () => {
    const t = table([{ tool: 'record-call', field: 'mobile' }]);
    const [button] = buttons(t, { mobile: ' 123456 ' });
    expect(recordRowValue(button!, t, record as never)).toEqual({
      type: 'text',
      text: '123456',
      name: 'Mobile',
    });
  });

  it('a record tool gives this one entry', () => {
    const t = table([{ tool: 'record-vcard' }]);
    const [button] = buttons(t, { name: 'A' });
    expect(recordRowValue(button!, t, record as never)).toEqual(recordsValue(t, [record as never]));
  });
});

describe('where it runs', () => {
  const preset = (id: string) => findWorkflow([], id, 'en') as Workflow;
  const text = { type: 'text' as const, text: '1', name: 'n' };
  const one = recordsValue(table(undefined), [{ id: 'r' } as never]);
  const many = recordsValue(table(undefined), [{ id: 'r' } as never, { id: 's' } as never]);

  it('one value or entry going out of the app runs in place: nothing to look at after', () => {
    expect(runsInline(preset('record-call'), text)).toBe(true);
    expect(runsInline(preset('record-vcard'), one)).toBe(true);
  });

  it('many entries, or a result that stays in the app, get the run page', () => {
    expect(runsInline(preset('record-vcard'), many)).toBe(false);
    expect(runsInline(preset('record-qr'), one)).toBe(false);
    expect(runsInline(preset('record-copy'), text)).toBe(false);
  });
});

describe('any field can be handed to a step that takes its kind (D-442)', () => {
  const step = (action: string) => ({
    id: 's0',
    action,
    params: initialParams(registry.actions.get(action)!),
  });
  const own = (id: string, action: string): QuickAction => ({
    id,
    kind: 'quickAction',
    name: id,
    steps: [step(action)],
  });
  const quick = [own('shrink', 'pdf.compress'), own('resize', 'image.resize')];
  const docs: Collection = {
    id: 'docs',
    name: 'Docs',
    fields: [
      { id: 'title', name: 'Title', type: 'text' },
      { id: 'total', name: 'Total', type: 'number' },
      { id: 'done', name: 'Done', type: 'checkbox' },
      { id: 'scan', name: 'Scan', type: 'file' },
    ],
    recordRow: [
      { tool: 'shrink', field: 'scan' },
      { tool: 'resize', field: 'scan' },
      { tool: 'record-copy', field: 'total' },
    ],
  };
  const info = (id: string, name: string, mimeType: string): AttachmentInfo => ({
    id,
    name,
    mimeType,
    size: 5,
  });
  const known = new Map([
    ['p1', info('p1', 'a.pdf', 'application/pdf')],
    ['i1', info('i1', 'a.jpg', 'image/jpeg')],
    ['p2', info('p2', 'b.pdf', 'application/pdf')],
  ]);
  const show = (t: Collection, values: Record<string, unknown>, assets = known) =>
    recordRowButtons(t, [...quickActions(), ...quick], registry, 'en', values, assets);

  it('shows a button per tool when the field has attachments the tool takes', () => {
    expect(show(docs, { scan: ['p1', 'i1', 'p2'] }).map((b) => b.key)).toEqual([
      'shrink-scan',
      'resize-scan',
    ]);
  });

  it('hands over only the attachments that tool takes, in order, as ids (copies are made at run time)', () => {
    const [shrink, resize] = show(docs, { scan: ['p1', 'i1', 'p2'] });
    expect(shrink!.files).toEqual({ fileType: 'pdf', assetIds: ['p1', 'p2'] });
    expect(resize!.files).toEqual({ fileType: 'images', assetIds: ['i1'] });
    const record = { id: 'r', collectionId: 'docs', values: {}, createdAt: 1, updatedAt: 1 };
    expect(recordRowValue(shrink!, docs, record as never)).toEqual({
      type: 'attachments',
      fileType: 'pdf',
      assetIds: ['p1', 'p2'],
      name: 'Scan',
    });
  });

  it('a tool whose kind is not among the attachments has no button', () => {
    expect(show(docs, { scan: ['p1', 'p2'] }).map((b) => b.key)).toEqual(['shrink-scan']);
  });

  it('no attachments, or attachments not found on this device, mean no button', () => {
    expect(show(docs, {})).toEqual([]);
    expect(show(docs, { scan: [] })).toEqual([]);
    expect(show(docs, { scan: ['gone'] })).toEqual([]);
    // 文件信息还没读到：先不显示，读到了再出现。
    expect(show(docs, { scan: ['p1'] }, new Map())).toEqual([]);
  });

  it('a number field hands over the text it shows', () => {
    const [button] = show(docs, { total: 12.5 }).filter((b) => b.key === 'record-copy-total');
    expect(button).toMatchObject({ text: '12.5' });
    expect(show(docs, {}).map((b) => b.key)).toEqual([]);
  });

  it('a checkbox field hands over nothing, so a text tool on it stays hidden', () => {
    const t = { ...docs, recordRow: [{ tool: 'record-copy', field: 'done' }] };
    expect(show(t, { done: true })).toEqual([]);
  });

  it('a files tool on a text field, or a text tool on an attachment field, stays hidden', () => {
    const t = {
      ...docs,
      recordRow: [
        { tool: 'shrink', field: 'title' },
        { tool: 'record-copy', field: 'scan' },
      ],
    };
    expect(show(t, { title: 'x', scan: ['p1'] })).toEqual([]);
  });

  it('files always get the run page: copying them first can take a while', () => {
    const wf = quick[0]!;
    const out = {
      type: 'attachments' as const,
      fileType: 'pdf' as const,
      assetIds: ['p1'],
      name: 'S',
    };
    expect(runsInline(wf as Workflow, out)).toBe(false);
    // 最后一步交给 App 外面也一样。
    expect(
      runsInline({ ...wf, steps: [step('pdf.compress'), step('out.share')] } as Workflow, out),
    ).toBe(false);
  });
});
