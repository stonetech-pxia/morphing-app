import {
  PDFCheckBox,
  PDFDropdown,
  type PDFField,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib';

import { PdfError, canEncodeStandardText, isEncodingError, loadPdf } from './core';

// 表单：列出字段、填写（可选拍平）。外观用 pdf-lib 默认的 Helvetica 生成，
// 所以填入的文字必须是标准字体可编码的。

export type FormFieldType = 'text' | 'checkbox' | 'dropdown' | 'radio' | 'optionList' | 'other';

export interface FormField {
  name: string;
  type: FormFieldType;
  /** 文本内容 / 勾选状态 / 选中的选项（optionList 多选时取第一个）。 */
  value?: string | boolean;
  options?: string[];
  multiline?: boolean;
  readOnly?: boolean;
}

function choice(
  base: { name: string; readOnly: boolean },
  type: FormFieldType,
  options: string[],
  selected: string | undefined,
): FormField {
  return { ...base, type, options, ...(selected !== undefined ? { value: selected } : {}) };
}

function describeField(field: PDFField): FormField {
  const base = { name: field.getName(), readOnly: field.isReadOnly() };
  if (field instanceof PDFTextField) {
    const text = field.getText();
    return {
      ...base,
      type: 'text',
      multiline: field.isMultiline(),
      ...(text !== undefined ? { value: text } : {}),
    };
  }
  if (field instanceof PDFCheckBox) return { ...base, type: 'checkbox', value: field.isChecked() };
  if (field instanceof PDFDropdown) {
    return choice(base, 'dropdown', field.getOptions(), field.getSelected()[0]);
  }
  if (field instanceof PDFRadioGroup) {
    return choice(base, 'radio', field.getOptions(), field.getSelected());
  }
  if (field instanceof PDFOptionList) {
    return choice(base, 'optionList', field.getOptions(), field.getSelected()[0]);
  }
  return { ...base, type: 'other' };
}

export async function listFormFields(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await loadPdf(bytes);
  return doc.getForm().getFields().map(describeField);
}

/** 值必须能用标准字体画出；多行文本逐行检查。 */
function assertEncodable(text: string, name: string): void {
  if (!text.split(/\r\n|\r|\n/).every(canEncodeStandardText)) {
    throw new PdfError('unsupportedText', undefined, name);
  }
}

function setField(field: PDFField, value: string | boolean, name: string): void {
  const bad = () => new PdfError('badField', undefined, name);
  if (field.isReadOnly()) throw bad();
  if (field instanceof PDFCheckBox) {
    if (typeof value !== 'boolean') throw bad();
    if (value) field.check();
    else field.uncheck();
    return;
  }
  if (typeof value !== 'string') throw bad();
  if (field instanceof PDFTextField) {
    assertEncodable(value, name);
    try {
      field.setText(value);
    } catch {
      throw bad(); // 例如超过 maxLength
    }
  } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    if (!field.getOptions().includes(value)) throw bad();
    assertEncodable(value, name);
    field.select(value);
  } else if (field instanceof PDFRadioGroup) {
    if (!field.getOptions().includes(value)) throw bad();
    field.select(value);
  } else {
    throw bad();
  }
}

/**
 * 按字段名填写：文本 / 下拉 / 单选 / 列表用字符串，复选框用布尔值。
 * 字段不存在、只读或值不匹配 → badField；无法编码的文字 → unsupportedText（都带 fieldName）。
 * flatten 为 true 时把字段画进页面并移除表单。
 */
export async function fillForm(
  bytes: Uint8Array,
  values: Readonly<Record<string, string | boolean>>,
  opts: { flatten: boolean },
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field) throw new PdfError('badField', undefined, name);
    setField(field, value, name);
  }
  try {
    if (opts.flatten) form.flatten();
    return await doc.save();
  } catch (e) {
    // 未填写的字段里原有的非 WinAnsi 文字，在重新生成外观时也会失败。
    if (isEncodingError(e)) throw new PdfError('unsupportedText');
    throw e;
  }
}
