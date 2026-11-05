import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { writeDocx } from './docx';
import { textToDocDoc } from './text-doc';

const documentXml = (text: string) =>
  strFromU8(unzipSync(writeDocx(textToDocDoc(text)))['word/document.xml']!);

describe('textToDocDoc', () => {
  it('makes one paragraph per blank-line-separated part and keeps line breaks inside it', () => {
    const doc = textToDocDoc('第一行\n第二行\n\n\n  \nSecond part\r\nline two\n');
    expect(doc.pages).toHaveLength(1);
    const texts = doc.pages[0]!.blocks.map((b) => (b.kind === 'paragraph' ? b.text : null));
    expect(texts).toEqual(['第一行\n第二行', 'Second part\nline two']);
  });

  it('leaves a gap before every paragraph but the first', () => {
    const blocks = textToDocDoc('a\n\nb\n\nc').pages[0]!.blocks;
    expect(blocks.map((b) => b.kind === 'paragraph' && b.spaced === true)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('has no blocks for text that is only whitespace', () => {
    expect(textToDocDoc(' \n\t\n\n').pages[0]!.blocks).toEqual([]);
  });

  it('writes a docx whose text can be read back, with Chinese fonts and escaped markup', () => {
    const xml = documentXml('签证材料 <清单> & "备注"\n第二行\n\n第二段');
    expect(xml).toContain('签证材料 &lt;清单&gt; &amp; &quot;备注&quot;');
    expect(xml).toContain('<w:br/><w:t xml:space="preserve">第二行</w:t>');
    expect(xml).toContain('第二段');
    // 每个 run 都写字体，东亚字体也在（苹果的预览不读默认样式）。
    expect(xml).toContain('w:eastAsia=');
    // 两个段落。
    expect(xml.match(/<w:p>|<w:p /g)).toHaveLength(2);
  });
});
