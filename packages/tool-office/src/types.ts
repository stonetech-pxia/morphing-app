// 扫描件转 Excel（D-272）的数据：TableDoc 是编辑页改的东西，xlsx 每次从它重新生成。

/** 像素坐标，原点在左上角。 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** RGBA 像素（每像素 4 字节）。 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** 识别出的一行（和找线那张图同一个坐标系）。 */
export interface OcrBox extends Box {
  text: string;
  /**
   * 每个字的大致位置（PP-OCRv6 的 CTC 时间步，D-272）：at 是字的中心在这一行里从左到右的比例（0–1）。
   * 没有时（系统识别）横跨竖线的行不能按字切开，整行按中心放进一格。
   */
  chars?: readonly { text: string; at: number }[];
}

/** 一个格子；合并单元格只有左上角那一个，rowSpan / colSpan 大于 1。网格里每个位置都正好属于一个格子。 */
export interface TableCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  /** 原图里这一格的位置（截图核对用）；编辑页插入的行列没有。 */
  box?: Box;
}

export interface TableBlock {
  kind: 'table';
  rows: number;
  cols: number;
  /** 每一列的宽度（原图像素）。 */
  colWidths: number[];
  /** 按行、列排好。 */
  cells: TableCell[];
  box: Box;
}

/** 表格外的一段文字（识别范围是「全部内容」时写进 xlsx，每段一行，横跨合并）。 */
export interface TextBlock {
  kind: 'text';
  text: string;
  box: Box;
}

export type Block = TableBlock | TextBlock;

export interface TablePage {
  /** 工作表名（写 xlsx 时再清理）。 */
  name: string;
  /** 用来截原图的那张图（找线那张）的 uri。 */
  source: string;
  /** 找线时那张图的大小：box 都在这个坐标系里，截图时按原图的实际大小换算。 */
  width: number;
  height: number;
  /** 这一页文字的典型行高（像素）：段落之间空隙超过 1.5 倍行高时空一行。 */
  lineHeight: number;
  /** 按阅读顺序（从上到下）。 */
  blocks: Block[];
}

export type TableScope = 'all' | 'tables';

export interface TableDoc {
  version: 1;
  /** 识别范围：只决定写 xlsx 时要不要写表外的文字，所以切换不会丢掉改过的内容。 */
  scope: TableScope;
  pages: TablePage[];
}
