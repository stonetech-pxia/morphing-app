import type { ActionImpl } from '@morph/core';

import type { RunServices } from './helpers';
import { COMPOSE_IMPLS } from './compose';
import { IMAGE_IMPLS } from './image';
import { IO_IMPLS } from './io';
import { MORE_IMPLS } from './more';
import { OCR_IMPLS } from './ocr';
import { PDF_IMPLS } from './pdf';
import { SCAN_IMPLS } from './scan';
import { TRANSLATE_IMPLS } from './translate';

// 所有动作实现。登记表里的每个动作都必须在这里有实现（runner-test 检查）。
export const ACTION_IMPLS: Readonly<Record<string, ActionImpl<RunServices>>> = {
  ...IO_IMPLS,
  ...PDF_IMPLS,
  ...IMAGE_IMPLS,
  ...SCAN_IMPLS,
  ...OCR_IMPLS,
  ...TRANSLATE_IMPLS,
  ...COMPOSE_IMPLS,
  ...MORE_IMPLS,
};

export type { RunServices } from './helpers';
