import type { ActionImpl } from '@morph/core';

import type { RunServices } from './helpers';
import { IO_IMPLS } from './io';
import { PDF_IMPLS } from './pdf';

// 所有动作实现。登记表里的每个动作都必须在这里有实现（runner-test 检查）。
export const ACTION_IMPLS: Readonly<Record<string, ActionImpl<RunServices>>> = {
  ...IO_IMPLS,
  ...PDF_IMPLS,
};

export type { RunServices } from './helpers';
