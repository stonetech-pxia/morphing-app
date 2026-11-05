import type { DocDoc, DocParagraph } from './doc';

// 文字转 Word（D-441）：一段文字 → DocDoc（一页，空行分段，段里的换行保留），再交给 writeDocx 写成 docx。
// 没有版面可言，所以 box 和页的尺寸只是占位；正文字号和字体用 docx 默认的（无衬线，东亚字体也写进每个 run）。

const BODY_SIZE = 11;
const BOX = { x: 0, y: 0, width: 1, height: 1 };

/** 按空行分段；段里的换行保留，每行去掉行尾的空白；全是空白的文字没有段落。 */
export function textToDocDoc(text: string): DocDoc {
  const parts = text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*(?:\n[ \t]*)+/)
    .map((part) =>
      part
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .replace(/^\n+|\n+$/g, ''),
    )
    .filter((part) => part.trim() !== '');
  const blocks: DocParagraph[] = parts.map((part, i) => ({
    kind: 'paragraph',
    text: part,
    ...(i > 0 ? { spaced: true } : {}),
    box: BOX,
  }));
  return {
    version: 1,
    pages: [{ source: '', width: 1000, height: 1400, bodySize: BODY_SIZE, blocks }],
  };
}
