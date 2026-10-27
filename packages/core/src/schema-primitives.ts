import { z } from 'zod';

// 配置里最基本的写法（语言、ID、有长度限制的文字）。字段定义（fields/）只依赖这里，
// 这样 schema-base.ts 可以从字段定义生成字段的结构，不会互相引用。对外从 schema.ts 导出。

export type Locale = 'en' | 'zh' | 'fr';
export type Localized = Record<Locale, string>;

const ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
export const IdSchema = z.string().regex(ID_PATTERN, 'id must be lowercase letters, digits or -');

/** 去掉首尾空白后长度在 min..max 之间的文字。 */
export const boundedText = (min: number, max: number) => z.string().trim().min(min).max(max);
