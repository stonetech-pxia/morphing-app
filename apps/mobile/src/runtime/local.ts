import type { RunItem } from '@morph/core';
import type { Quad } from '@morph/tool-image';

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
  /**
   * 扫描：逐张确认或拖动纸张的四个角（原图像素坐标）。quad 是扫描包找到的角，找不到时为 null。
   * 返回每张图最终的四个角。
   */
  corners: { in: { items: { item: RunItem; quad: Quad | null }[] }; out: Quad[] };
  /** 打码：在每张图上框出要遮住的区域（原图像素）。返回每张图的框，可以没有。 */
  redact: { in: { items: RunItem[] }; out: Rect[][] };
  /** 排序、删除：返回保留下来的下标，按新顺序。 */
  reorder: { in: { items: RunItem[] }; out: number[] };
  /**
   * 剪一段（视频、音频共用，D-134）：逐个选开始和结束（毫秒）。视频显示画面，音频以后显示波形。
   * 返回每个文件选的一段。
   */
  trimMedia: {
    in: { items: RunItem[] };
    out: { startMs: number; endMs: number }[];
  };
}

export type LocalKind = keyof LocalSteps;

export interface LocalUi {
  /** 简单的二选一，例如「再拍一张？」。 */
  confirm(title: string, ok: string, cancel: string): Promise<boolean>;
  /**
   * 运行中问一句（固定的几种问题，文字在 App 里写好，不是 AI 生成的），例如压缩 PDF 不够小时
   * 「转成图片 / 就用现在的」。返回选了第几个，取消返回 null。
   */
  choose(title: string, message: string, options: readonly string[]): Promise<number | null>;
  /** 打开本地操作界面；用户取消时返回 null。 */
  open<K extends LocalKind>(
    kind: K,
    input: LocalSteps[K]['in'],
  ): Promise<LocalSteps[K]['out'] | null>;
}
