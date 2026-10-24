import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { DEV_TOOL_SIGNING_KEY, type ToolManifest } from '@morph/core';
import { describe, expect, it } from 'vitest';

import {
  buildCatalog,
  readSecretKey,
  revokeVersion,
  signCatalogFile,
  signCatalogWithKey,
  verifyOutput,
} from './publish';

// 发布下载的工具（D-177、D-178）。

const repo = resolve(import.meta.dirname, '../../..');
const devKey = join(repo, 'tools/dev-signing-key.txt');

/** 一个临时的 tools/ 目录（复制仓库里的示例工具）和输出目录。 */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'morph-tools-'));
  const tools = join(dir, 'tools');
  cpSync(join(repo, 'tools/job-apply'), join(tools, 'job-apply'), { recursive: true });
  return { tools, out: join(dir, 'out') };
}
const manifestFile = (tools: string) => join(tools, 'job-apply/manifest.json');
const editManifest = (tools: string, change: (m: ToolManifest) => void) => {
  const m = JSON.parse(readFileSync(manifestFile(tools), 'utf8')) as ToolManifest;
  change(m);
  writeFileSync(manifestFile(tools), JSON.stringify(m, null, 2));
};

describe('publishing downloaded tools', () => {
  it('builds, signs and verifies a catalog of the tools in tools/', () => {
    const { tools, out } = setup();
    const catalog = buildCatalog(tools, out, new Date('2026-10-24T08:00:00Z'));
    expect(catalog.seq).toBe(1);
    expect(catalog.tools.map((e) => [e.id, e.version, e.path])).toEqual([
      ['job-apply', '1.0.0', 'tools/job-apply/1.0.0.json'],
    ]);
    expect(signCatalogFile(out, devKey)).toBe(DEV_TOOL_SIGNING_KEY);
    expect(verifyOutput(out, [DEV_TOOL_SIGNING_KEY]).seq).toBe(1);
    // 正式的公钥验不过开发私钥的签名。
    expect(() => verifyOutput(out, [])).toThrow(/signature/);
  });

  it('signs with a pasted key and refuses something that is not a key', () => {
    const { tools, out } = setup();
    buildCatalog(tools, out);
    expect(signCatalogWithKey(out, readSecretKey(devKey))).toBe(DEV_TOOL_SIGNING_KEY);
    expect(verifyOutput(out, [DEV_TOOL_SIGNING_KEY]).seq).toBe(1);
    expect(() => signCatalogWithKey(out, 'not-a-key')).toThrow(/not a signing key/);
  });

  it('refuses an older version, changed content under the same version, and a dropped tool', () => {
    const { tools, out } = setup();
    editManifest(tools, (m) => (m.version = '1.2.0'));
    buildCatalog(tools, out);
    editManifest(tools, (m) => (m.version = '1.1.0'));
    expect(() => buildCatalog(tools, out)).toThrow(/older than 1\.2\.0/);
    editManifest(tools, (m) => {
      m.version = '1.2.0';
      m.intro.en = 'Changed after publishing.';
    });
    expect(() => buildCatalog(tools, out)).toThrow(/already published with other content/);
    const empty = mkdtempSync(join(tmpdir(), 'morph-empty-'));
    expect(() => buildCatalog(empty, out)).toThrow(/keep it in tools/);
  });

  it('refuses an update that would break quick actions people already added', () => {
    const { tools, out } = setup();
    buildCatalog(tools, out);
    // 新版本不再声明「选文件」权限：老版本的快捷操作就校验不过了。
    editManifest(tools, (m) => {
      m.version = '1.1.0';
      m.permissions = [];
    });
    expect(() => buildCatalog(tools, out)).toThrow();
    editManifest(tools, (m) => (m.permissions = ['files.pick']));
    expect(buildCatalog(tools, out).seq).toBe(2);
  });

  it('revokes a version with a new seq', () => {
    const { tools, out } = setup();
    buildCatalog(tools, out);
    const revoked = revokeVersion(out, 'job-apply@1.0.0');
    expect(revoked.seq).toBe(2);
    expect(revoked.revoked).toEqual(['job-apply@1.0.0']);
    expect(() => revokeVersion(out, 'nothing@1.0.0')).toThrow();
    // 停用名单在下一次 build 时保留。
    expect(buildCatalog(tools, out).revoked).toEqual(['job-apply@1.0.0']);
  });
});
