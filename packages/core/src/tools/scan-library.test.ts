import { describe, expect, it } from 'vitest';

import { scanWorkflows } from './scan';

// D-450：扫描的文件都留在 App 的文档库（创始人 2026-11-05 在对话里定）：扫描成 PDF 的内设快捷操作最后一步存到文件。
describe('scan presets keep the result in the app', () => {
  it.each(['zh', 'en', 'fr'] as const)(
    'scan-camera and scan-library end with file.save (%s)',
    (locale) => {
      const flows = scanWorkflows(locale);
      for (const id of ['scan-camera', 'scan-library']) {
        const steps = flows.find((w) => w.id === id)!.steps;
        expect(steps.at(-1)!.action).toBe('file.save');
        // D-455：带文字层，文档库能按 PDF 里的字搜。
        expect(steps.find((s) => s.action === 'pdf.fromImages')!.params).toMatchObject({
          textLayer: true,
        });
      }
    },
  );

  it('straightening photos does not make a document, so it does not save', () => {
    const steps = scanWorkflows('zh').find((w) => w.id === 'scan-straighten')!.steps;
    expect(steps.map((s) => s.action)).not.toContain('file.save');
  });
});
