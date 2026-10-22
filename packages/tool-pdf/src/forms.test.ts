import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { fillForm, listFormFields } from './index';
import { pageContent } from './test-helpers';

/** 用 pdf-lib 生成真实表单：文本、多行文本、复选框、下拉、单选、只读文本。 */
async function makeForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  form.createTextField('name').addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
  const notes = form.createTextField('notes');
  notes.enableMultiline();
  notes.addToPage(page, { x: 50, y: 600, width: 200, height: 80 });
  form.createCheckBox('agree').addToPage(page, { x: 50, y: 550, width: 20, height: 20 });
  const country = form.createDropdown('country');
  country.setOptions(['France', 'China']);
  country.addToPage(page, { x: 50, y: 500, width: 200, height: 24 });
  const size = form.createRadioGroup('size');
  size.addOptionToPage('S', page, { x: 50, y: 450, width: 20, height: 20 });
  size.addOptionToPage('L', page, { x: 100, y: 450, width: 20, height: 20 });
  const locked = form.createTextField('locked');
  locked.setText('fixed');
  locked.enableReadOnly();
  locked.addToPage(page, { x: 50, y: 400, width: 200, height: 24 });
  return doc.save();
}

describe('listFormFields', () => {
  it('describes every field', async () => {
    expect(await listFormFields(await makeForm())).toEqual([
      { name: 'name', type: 'text', multiline: false, readOnly: false },
      { name: 'notes', type: 'text', multiline: true, readOnly: false },
      { name: 'agree', type: 'checkbox', value: false, readOnly: false },
      { name: 'country', type: 'dropdown', options: ['France', 'China'], readOnly: false },
      { name: 'size', type: 'radio', options: ['S', 'L'], readOnly: false },
      { name: 'locked', type: 'text', value: 'fixed', multiline: false, readOnly: true },
    ]);
  });

  it('returns nothing for a PDF without a form', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(await listFormFields(await doc.save())).toEqual([]);
  });
});

describe('fillForm', () => {
  const values = {
    name: 'Zoë Martin',
    notes: 'line one\nline two',
    agree: true,
    country: 'China',
    size: 'L',
  };

  it('fills fields and keeps them editable', async () => {
    const out = await fillForm(await makeForm(), values, { flatten: false });
    const fields = await listFormFields(out);
    expect(fields.map((f) => [f.name, f.value])).toEqual([
      ['name', 'Zoë Martin'],
      ['notes', 'line one\nline two'],
      ['agree', true],
      ['country', 'China'],
      ['size', 'L'],
      ['locked', 'fixed'],
    ]);
  });

  it('flattens the form into the page', async () => {
    const out = await fillForm(await makeForm(), values, { flatten: true });
    expect(await listFormFields(out)).toEqual([]);
    expect(await pageContent(out, 0)).toMatch(/Do/);
  });

  it('reports the field that cannot be filled', async () => {
    const form = await makeForm();
    const fill = (v: Record<string, string | boolean>) => fillForm(form, v, { flatten: false });
    await expect(fill({ nickname: 'x' })).rejects.toMatchObject({
      code: 'badField',
      fieldName: 'nickname',
    });
    await expect(fill({ name: '张三' })).rejects.toMatchObject({
      code: 'unsupportedText',
      fieldName: 'name',
    });
    for (const bad of [
      { agree: 'yes' },
      { name: true },
      { country: 'Spain' },
      { size: 'M' },
      { locked: 'x' },
    ]) {
      await expect(fill(bad)).rejects.toMatchObject({
        code: 'badField',
        fieldName: Object.keys(bad)[0],
      });
    }
  });
});
