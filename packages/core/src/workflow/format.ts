import { renderNameTemplate } from '../naming';
import type { Locale } from '../schema';
import type { ActionDefinition, ParamField } from './contract';

// 把参数值写成用户看得懂的话（修改说明、工作流卡片、编辑页共用）。

export function formatParamValue(
  field: ParamField,
  value: unknown,
  locale: Locale,
  now: Date,
): string {
  const zh = locale === 'zh';
  switch (field.kind) {
    case 'choice': {
      const option = field.options?.find((o) => o.value === value);
      return option ? option.label[locale] : String(value);
    }
    case 'toggle':
      return value ? (zh ? '开' : 'on') : zh ? '关' : 'off';
    case 'nameTemplate': {
      const template = String(value);
      const example = renderNameTemplate(template, {
        now,
        index: 1,
        sourceName: zh ? '报告' : 'report',
      });
      return template === example
        ? template
        : `${template}${zh ? `（例如 ${example}）` : ` (e.g. ${example})`}`;
    }
    case 'number':
      return field.unit ? `${String(value)} ${field.unit}` : String(value);
    default:
      return String(value);
  }
}

/** 一组参数的说明：「目标大小 200 KB、格式 JPEG」。只列出 fields 里有、并且显示条件成立的参数。 */
export function describeParams(
  action: ActionDefinition,
  params: Record<string, unknown>,
  locale: Locale,
  now: Date,
  only?: readonly string[],
): string {
  const parts: string[] = [];
  for (const field of action.fields) {
    if (only && !only.includes(field.key)) continue;
    if (!(field.key in params)) continue;
    if (field.showIf && !field.showIf.equals.includes(params[field.showIf.key] as never)) continue;
    const value = field.private
      ? locale === 'zh'
        ? '（你写的文字）'
        : '(your text)'
      : params[field.key];
    parts.push(`${field.label[locale]} ${formatParamValue(field, value, locale, now)}`);
  }
  return parts.join(locale === 'zh' ? '、' : ', ');
}
