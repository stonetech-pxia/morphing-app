import { formatNumber } from '../data';
import { localize } from '../localization';
import { t } from '../messages';
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
  switch (field.kind) {
    case 'choice': {
      const option = field.options?.find((o) => o.value === value);
      return option ? localize(option.label, locale) : String(value);
    }
    case 'toggle':
      return value ? t(locale, 'format_on_7f2b0') : t(locale, 'format_off_4b193');
    case 'nameTemplate': {
      const template = String(value);
      const example = renderNameTemplate(template, {
        now,
        index: 1,
        sourceName: t(locale, 'format_report_25207'),
      });
      return template === example
        ? template
        : `${template}${t(locale, 'format_e_g_248d5', { v0: example })}`;
    }
    case 'number': {
      // 法语的小数点是逗号（0,5）。
      const shown =
        locale === 'fr' && typeof value === 'number'
          ? formatNumber(value, undefined, 'fr')
          : String(value);
      return field.unit ? `${shown} ${field.unit}` : shown;
    }
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
    const value = field.private ? t(locale, 'format_your_text_6c667') : params[field.key];
    parts.push(`${localize(field.label, locale)} ${formatParamValue(field, value, locale, now)}`);
  }
  return parts.join(t(locale, 'separatorList'));
}
