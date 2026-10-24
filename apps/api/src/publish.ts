import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BUILTIN_TOOLS,
  CatalogSchema,
  applyOps,
  compareVersions,
  createDefaultWorkspace,
  createRegistry,
  generateSigningKey,
  parseToolManifest,
  publicKeyOf,
  registerTool,
  signCatalog,
  toolFromManifest,
  toolManifestUrl,
  validateWorkspace,
  verifyCatalog,
  type Catalog,
  type CatalogEntry,
  type ToolManifest,
} from '@morph/core';

// 发布下载的工具（D-177、D-178，docs/TOOL_DOWNLOAD_DESIGN.md §9）。
//   build：tools/<id>/manifest.json → <out>/tools/<id>/<version>.json + <out>/catalog.json（未签名）
//   sign：在离线的机器上用私钥给 <out>/catalog.json 签名 → <out>/catalog.sig
//   revoke：把一个版本写进停用名单（之后要重新签名）
//   verify：上传前再检查一遍签名、大小和哈希
// <out> 目录整个上传到托管（Cloudflare R2）；托管的地方不需要可信，内容都签了名。

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const readCatalog = (out: string): Catalog | null =>
  existsSync(join(out, 'catalog.json'))
    ? CatalogSchema.parse(JSON.parse(readFileSync(join(out, 'catalog.json'), 'utf8')))
    : null;
const writeCatalog = (out: string, catalog: Catalog) =>
  writeFileSync(join(out, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);

/**
 * 新版本必须能接受老版本的配置（§5）：在空白工作空间里添加老版本，再用新版本校验。
 * 用户已经添加的快捷操作在「更新」之前仍是老版本的步骤，新版本不能让它们校验不过。
 */
function compatibilityProblems(previous: ToolManifest, next: ToolManifest): string[] {
  const problems: string[] = [];
  for (const locale of ['en', 'zh'] as const) {
    const old = createRegistry(BUILTIN_TOOLS);
    registerTool(old, toolFromManifest(previous));
    const applied = applyOps(
      createDefaultWorkspace(locale),
      [{ op: 'installTool', toolId: previous.id }],
      { registry: old, locale },
    );
    if (!applied.ok) continue;
    const updated = createRegistry(BUILTIN_TOOLS);
    registerTool(updated, toolFromManifest(next));
    const valid = validateWorkspace(applied.config, updated);
    if (!valid.ok) problems.push(...valid.issues.map((i) => `${locale}: ${i.message}`));
  }
  return problems;
}

/**
 * 把 tools/ 下的每个清单检查一遍，复制进输出目录，生成新的目录（seq 加 1，停用名单保留）。
 * 版本号不能比已发布的旧；版本号没变时内容也不能变（已经发出去的文件不能悄悄换掉）。
 */
export function buildCatalog(toolsDir: string, out: string, now = new Date()): Catalog {
  const previous = readCatalog(out);
  const registry = createRegistry(BUILTIN_TOOLS);
  const entries: CatalogEntry[] = [];
  const problems: string[] = [];
  for (const id of readdirSync(toolsDir).sort()) {
    const file = join(toolsDir, id, 'manifest.json');
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    let manifest: ToolManifest;
    try {
      manifest = parseToolManifest(bytes, registry);
    } catch (e) {
      problems.push(`${id}: ${String(e)}`);
      continue;
    }
    if (manifest.id !== id) {
      problems.push(`${id}: the folder name must be the tool id (${manifest.id})`);
      continue;
    }
    const path = `tools/${manifest.id}/${manifest.version}.json`;
    const before = previous?.tools.find((e) => e.id === manifest.id);
    if (before) {
      const order = compareVersions(manifest.version, before.version);
      if (order < 0) problems.push(`${id}: ${manifest.version} is older than ${before.version}`);
      if (order === 0 && sha256(bytes) !== before.sha256) {
        problems.push(`${id}: ${manifest.version} was already published with other content`);
      }
      if (order > 0) {
        const old = JSON.parse(readFileSync(join(out, before.path), 'utf8')) as ToolManifest;
        problems.push(...compatibilityProblems(old, manifest).map((p) => `${id}: ${p}`));
      }
    }
    mkdirSync(join(out, 'tools', manifest.id), { recursive: true });
    writeFileSync(join(out, path), bytes);
    entries.push({
      id: manifest.id,
      version: manifest.version,
      hostApi: manifest.hostApi,
      path,
      size: bytes.length,
      sha256: sha256(bytes),
      name: manifest.name,
      description: manifest.description,
      icon: manifest.icon,
    });
  }
  // 已发布、但这次 tools/ 里没有的工具也要留着：已经添加了它的用户还要用（计划服务靠目录认识它）。
  for (const old of previous?.tools ?? []) {
    if (!entries.some((e) => e.id === old.id)) {
      problems.push(`${old.id}: was published before; keep it in tools/ (revoke it instead)`);
    }
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));
  const catalog: Catalog = {
    format: 1,
    seq: (previous?.seq ?? 0) + 1,
    issuedAt: now.toISOString(),
    tools: entries,
    revoked: previous?.revoked ?? [],
  };
  CatalogSchema.parse(catalog);
  mkdirSync(out, { recursive: true });
  writeCatalog(out, catalog);
  return catalog;
}

/** 停用一个版本（id@version）。改了目录，要重新签名。 */
export function revokeVersion(out: string, idAtVersion: string, now = new Date()): Catalog {
  const catalog = readCatalog(out);
  if (!catalog) throw new Error('no catalog.json; run build first');
  const [id, version] = idAtVersion.split('@');
  const published = catalog.tools.some((e) => e.id === id);
  if (!published || !version) throw new Error(`${idAtVersion} is not a published tool version`);
  const next: Catalog = {
    ...catalog,
    seq: catalog.seq + 1,
    issuedAt: now.toISOString(),
    revoked: [...new Set([...catalog.revoked, idAtVersion])],
  };
  CatalogSchema.parse(next);
  writeCatalog(out, next);
  return next;
}

/** 读私钥文件：一行 base64，# 开头的行是说明。 */
export function readSecretKey(file: string): string {
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  if (!line) throw new Error(`${file} has no key`);
  return line;
}

/** 用私钥（base64）给目录签名，返回签名用的公钥（发布前对一下是不是 App 里内置的那一个）。 */
export function signCatalogWithKey(out: string, secretKey: string): string {
  let publicKey: string;
  try {
    publicKey = publicKeyOf(secretKey);
  } catch {
    throw new Error('that is not a signing key (expected 44 characters of base64)');
  }
  const bytes = readFileSync(join(out, 'catalog.json'));
  writeFileSync(join(out, 'catalog.sig'), `${signCatalog(bytes, secretKey)}\n`);
  return publicKey;
}

/** 用私钥文件给目录签名（开发密钥 tools/dev-signing-key.txt 这样用）。 */
export function signCatalogFile(out: string, secretKeyFile: string): string {
  return signCatalogWithKey(out, readSecretKey(secretKeyFile));
}

/** 上传前检查：签名、每个清单的大小和哈希、清单能装进内置注册表。 */
export function verifyOutput(out: string, trustedKeys: readonly string[]): Catalog {
  const catalog = verifyCatalog(
    readFileSync(join(out, 'catalog.json')),
    readFileSync(join(out, 'catalog.sig'), 'utf8'),
    trustedKeys,
  );
  const registry = createRegistry(BUILTIN_TOOLS);
  for (const entry of catalog.tools) {
    const bytes = readFileSync(join(out, entry.path));
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) {
      throw new Error(`${entry.id}: ${toolManifestUrl('.', entry)} does not match the catalog`);
    }
    parseToolManifest(bytes, registry, entry);
  }
  return catalog;
}

/** 新的一对密钥：私钥写进文件（只有自己能读），返回公钥。 */
export function keygen(file: string): string {
  if (existsSync(file)) throw new Error(`${file} already exists; not overwriting a key`);
  const { secretKey, publicKey } = generateSigningKey();
  writeFileSync(
    file,
    `# Morph 工具目录的签名私钥（D-178）。离线保管，不进仓库，不放在任何服务器上。\n${secretKey}\n`,
    { mode: 0o600 },
  );
  return publicKey;
}
