// 门户的「Clay」预设（App 文件，D-487）：新用户默认界面的精修版——扫描和转换的快捷操作放在最前面，
// 文件按类型摆好，工具箱在底栏上。纯配置，没有表、没有记录、不带用户文件。
// 用法：npx tsx scripts/build-clay-app.ts <输出目录（packages/core/src/fixtures/portal-apps）>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { prepareOps } from '../packages/core/src/change';
import {
  appFileFromWorkspace,
  appFileOps,
  appFileText,
  readAppFile,
} from '../packages/core/src/app-file';
import { applyOps } from '../packages/core/src/ops';
import { createRegistry } from '../packages/core/src/registry';
import { createStarterWorkspace, homeFileEntryOps } from '../packages/core/src/starter';
import { BUILTIN_TOOLS } from '../packages/core/src/tools';
import { validateWorkspace } from '../packages/core/src/validate';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: build-clay-app.ts <out dir>');
const registry = createRegistry(BUILTIN_TOOLS);
const NOW = new Date('2026-11-07T12:00:00');
const ctx = { registry, locale: 'en' as const, now: NOW };

// 1. 新用户的起始配置 + 引导给的首页入口（就是 D-487 的默认首页）。
const starter = createStarterWorkspace('en', registry);
const withHome = applyOps(starter, homeFileEntryOps(starter, 'en'), ctx);
if (!withHome.ok) throw new Error(withHome.error);
const config = structuredClone(withHome.config);

// 2. 预设里首页不放工具箱入口（工具箱在底栏上），多一页「文件」：按类型分开摆。
const home = config.containers.pages.find((p) => p.id === 'home')!;
home.blocks = home.blocks.filter((b) => b.id !== 'toolbox-entry');
const shelf = (id: string, title: string, kind: string) => ({
  id,
  look: 'files' as const,
  show: { title },
  source: {
    table: '$files' as const,
    filter: [{ field: 'kind', op: 'is', value: kind }],
    limit: 5,
  },
});
config.containers.pages.push({
  id: 'files',
  title: 'Files',
  icon: 'document',
  blocks: [
    {
      id: 'files-hello',
      look: 'header',
      show: { title: 'Files', subtitle: 'Everything you scan, convert or open, by type.' },
    },
    shelf('shelf-pdf', 'PDFs', 'pdf'),
    shelf('shelf-doc', 'Word', 'doc'),
    shelf('shelf-sheet', 'Excel', 'sheet'),
    shelf('shelf-image', 'Pictures', 'image'),
  ],
} as never);
// 整份配置的底栏必须有设置；转成 App 文件时设置会被去掉（App 的底栏只有页面和 Tink）。
config.nav.bar = ['page:home', 'page:files', 'page:toolbox', 'ai', 'settings'];

const valid = validateWorkspace(config, registry);
if (!valid.ok) throw new Error(valid.issues.map((i) => `${i.code}: ${i.message}`).join('\n'));

// 3. 转成 App 文件，读回来，导入到一个新用户的工作区里试一遍。
const file = appFileFromWorkspace(config, { id: 'clay', name: 'Clay', icon: 'paper' });
const text = appFileText(file, NOW);
const back = readAppFile(text);
if (!back) throw new Error('written file does not read back');
const plan = appFileOps(back, createStarterWorkspace('en', registry));
if (!plan.ok) throw new Error(plan.error);
const check = prepareOps(createStarterWorkspace('en', registry), plan.ops, ctx);
if (!check.ok) throw new Error(check.issues.join('; '));
writeFileSync(join(outDir, 'tinkrum-app-clay.json'), text);

// 4. 清单里加（或更新）一条，放在第一个。
const manifestPath = join(outDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { apps: { id: string }[] };
const entry = {
  id: 'clay',
  name: 'Clay',
  tagline: 'The Tinkrum look, refined: scan shortcuts up front, a shelf for every file',
  style: 'Clay',
  file: 'tinkrum-app-clay.json',
  schemaVersion: file.schemaVersion,
  pages: config.containers.pages.filter((p) => p.package === undefined).map((p) => p.title),
  tables: [],
  reminders: 0,
  quickActions: 0,
  features: [
    'One-tap scan to PDF, Word or Excel, and combine documents',
    'Open files from the photo library or Files',
    'Recent actions and recent files on the home page',
    'Files shelved by type: PDF, Word, Excel, pictures',
    'Toolbox in the bar; light and dark follow the phone',
  ],
  includesRecords: false,
  icon: 'paper',
};
manifest.apps = [entry, ...manifest.apps.filter((a) => a.id !== 'clay')];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('OK clay', plan.ops.length, 'steps');
