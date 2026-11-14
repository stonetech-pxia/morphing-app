// LibreOffice 把转出的 docx 画成图，和原页并排放进一个 HTML 页面，给人看。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';

import { ENV, need } from './env';

/** dir/out.docx → dir/render-N.png，返回文件名。 */
export function renderDocx(dir: string): string[] {
  if (!existsSync(`${dir}/out.docx`)) return [];
  execFileSync(
    need(ENV.soffice, 'LibreOffice'),
    ['--headless', '--convert-to', 'pdf', '--outdir', dir, `${dir}/out.docx`],
    {
      stdio: 'ignore',
      timeout: 120000,
      env: existsSync(ENV.fontconfig)
        ? { ...process.env, FONTCONFIG_FILE: process.env.FONTCONFIG_FILE ?? ENV.fontconfig }
        : process.env,
    },
  );
  if (!existsSync(`${dir}/out.pdf`)) return [];
  execFileSync(
    need(ENV.pdftoppm, 'pdftoppm'),
    ['-r', '80', '-png', `${dir}/out.pdf`, `${dir}/render`],
    {
      timeout: 120000,
    },
  );
  return readdirSync(dir)
    .filter((f) => f.startsWith('render') && f.endsWith('.png'))
    .sort();
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export interface Row {
  /** 相对 index.html 的目录。 */
  dir: string;
  title: string;
  subtitle: string;
  status: 'ok' | 'fail' | 'known';
  notes: string[];
  renders: string[];
}

export function writeIndex(file: string, heading: string, rows: Row[]) {
  const body = rows
    .map(
      (
        r,
      ) => `<section class="${r.status}"><h2>${escapeHtml(r.title)} <small>${escapeHtml(r.subtitle)}</small></h2>
${r.notes.length ? `<ul>${r.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
<div class="pair"><img src="${r.dir}/page.jpg"><div>${r.renders.map((o) => `<img src="${r.dir}/${o}">`).join('')}</div></div></section>`,
    )
    .join('\n');
  writeFileSync(
    file,
    `<!doctype html><meta charset="utf-8"><title>Word conversion review</title><style>
body{font:14px system-ui;margin:16px;background:#fafafa}section{background:#fff;margin:0 0 24px;padding:12px;border-left:6px solid #2a2}
section.fail{border-color:#d22}section.known{border-color:#d90}h2{font-size:16px;margin:0}small{color:#666;font-weight:normal}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pair img{width:100%;border:1px solid #ccc;margin-bottom:6px}</style>
<h1>${escapeHtml(heading)}</h1>${body}`,
  );
}
