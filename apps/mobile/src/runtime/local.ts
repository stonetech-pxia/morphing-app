import type { RunItem } from '@morph/core';

// 本地操作步骤（TOOLS_DESIGN §4）：执行到这里时，运行页面打开对应的界面，用户的操作结果只在本次运行里使用。
// 每种界面的输入和输出在这里登记；运行页面（app/run/[workflowId].tsx）负责显示。

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LocalSteps {
  /** 逐张框选裁剪区域（原图像素）。aspect 为 null 时自由比例。 */
  crop: { in: { items: RunItem[]; aspect: number | null }; out: Rect[] };
  /**
   * 整理 PDF 页面：选页、删页、排序、旋转。返回保留的页（0 起的原页码），按新顺序，
   * rotate 是在原来基础上再顺时针转的角度。thumbnails 有 PDF 预览包时才有。
   */
  pages: {
    in: {
      item: RunItem;
      pages: { width: number; height: number; rotation: number }[];
      thumbnails?: string[];
    };
    out: { index: number; rotate: 0 | 90 | 180 | 270 }[];
  };
  /**
   * 签名：选一个存好的签名或现画一个，放到某一页上。pages 是页面预览图（PDF 预览包渲染）。
   * 返回签名 PNG 和位置（页面比例坐标，左上角为原点）。
   */
  sign: {
    in: { item: RunItem; pages: { uri: string; width: number; height: number }[] };
    out: { png: Uint8Array; pageIndex: number; x: number; y: number; width: number };
  };
  /** 填表：字段由 pdf-lib 读出，用户在本地填写。返回字段名 → 值。 */
  fillForm: {
    in: {
      item: RunItem;
      fields: {
        name: string;
        type: string;
        value?: string | boolean;
        options?: string[];
        multiline?: boolean;
        readOnly?: boolean;
      }[];
    };
    out: Record<string, string | boolean>;
  };
  /** 排序、删除：返回保留下来的下标，按新顺序。 */
  reorder: { in: { items: RunItem[] }; out: number[] };
}

export type LocalKind = keyof LocalSteps;

export interface LocalUi {
  /** 简单的二选一，例如「再拍一张？」。 */
  confirm(title: string, ok: string, cancel: string): Promise<boolean>;
  /** 打开本地操作界面；用户取消时返回 null。 */
  open<K extends LocalKind>(
    kind: K,
    input: LocalSteps[K]['in'],
  ): Promise<LocalSteps[K]['out'] | null>;
}
