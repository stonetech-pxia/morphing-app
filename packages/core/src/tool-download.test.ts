/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyOps } from './ops';
import { createRegistry, registerTool, registryRevision } from './registry';
import { createDefaultWorkspace } from './defaults';
import {
  HOST_API,
  ToolDownloadError,
  checkToolManifest,
  compareVersions,
  decodeUtf8,
  generateSigningKey,
  isRevoked,
  parseToolManifest,
  publicKeyOf,
  signCatalog,
  toolFromManifest,
  toolManifestUrl,
  verifyCatalog,
  type Catalog,
  type ToolManifest,
} from './tool-download';
import { DEV_TOOL_SIGNING_KEY, trustedToolKeys } from './tool-keys';
import { BUILTIN_TOOLS } from './tools';
import { validateWorkspace } from './validate';

const repoFile = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

const example = (): ToolManifest =>
  JSON.parse(repoFile('tools/job-apply/manifest.json')) as ToolManifest;
const freshRegistry = () => createRegistry(BUILTIN_TOOLS);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('tool manifests (D-177)', () => {
  it('accepts old bilingual manifests in French without rewriting their metadata', () => {
    const manifest = example();
    expect(manifest.name.fr).toBeUndefined();
    const original = structuredClone(manifest);
    const registry = freshRegistry();
    const tool = toolFromManifest(manifest);
    registerTool(registry, tool);
    const result = applyOps(
      createDefaultWorkspace('fr'),
      [{ op: 'installTool', toolId: tool.id }],
      { registry, locale: 'fr' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateWorkspace(result.config, registry)).toMatchObject({ ok: true });
    expect(tool.name.fr).toBe(manifest.name.en);
    expect(manifest).toEqual(original);
  });
  it('the example data tool in tools/ passes every check', () => {
    expect(checkToolManifest(example(), freshRegistry())).toEqual([]);
  });

  it('becomes a tool whose page and quick actions follow the locale', () => {
    const tool = toolFromManifest(example());
    expect(tool.origin).toBe('download');
    expect(tool.actions).toEqual([]);
    expect(tool.createPage('zh').title).toBe('求职材料');
    expect(tool.createPage('en').components.map((c) => c.type)).toEqual([
      'header',
      'text',
      'workflowRunner',
      'workflowRunner',
    ]);
    expect(tool.createWorkflows('zh').map((w) => [w.name, w.toolId])).toEqual([
      ['简历和证书合成一个 PDF', 'job-apply'],
      ['头像压到 200 KB', 'job-apply'],
    ]);
  });

  it('can be added, updated and removed like a built-in tool', () => {
    const registry = freshRegistry();
    const before = registryRevision(registry);
    registerTool(registry, toolFromManifest(example()));
    expect(registryRevision(registry)).toBe(before + 1);

    const added = applyOps(
      createDefaultWorkspace('zh'),
      [{ op: 'installTool', toolId: 'job-apply' }],
      {
        registry,
        locale: 'zh',
      },
    );
    if (!added.ok) throw new Error(added.error);
    expect(validateWorkspace(added.config, registry).ok).toBe(true);
    expect(added.config.tools).toContainEqual({
      toolId: 'job-apply',
      version: '1.0.0',
      pageId: 'tool-job-apply',
    });

    // 新版本多了一个快捷操作：「更新」补上它，保留用户的修改。
    const next = example();
    next.version = '1.1.0';
    next.workflows.push({
      id: 'job-apply-letter',
      name: { en: 'Cover letter to PDF', zh: '求职信转 PDF', fr: 'Cover letter to PDF' },
      steps: [
        { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
        { id: 'share', action: 'out.share', params: {} },
      ],
    });
    registerTool(registry, toolFromManifest(next));
    const updated = applyOps(added.config, [{ op: 'updateTool', toolId: 'job-apply' }], {
      registry,
      locale: 'zh',
    });
    if (!updated.ok) throw new Error(updated.error);
    expect(updated.config.workflows.map((w) => w.id)).toContain('job-apply-letter');
    expect(updated.config.tools.find((t) => t.toolId === 'job-apply')?.version).toBe('1.1.0');

    const removed = applyOps(updated.config, [{ op: 'uninstallTool', toolId: 'job-apply' }], {
      registry,
      locale: 'zh',
    });
    if (!removed.ok) throw new Error(removed.error);
    expect(removed.config.workflows.some((w) => w.toolId === 'job-apply')).toBe(false);
    expect(validateWorkspace(removed.config, registry).ok).toBe(true);
  });

  it('a config that uses a downloaded tool does not validate without it (restore on a new phone)', () => {
    const registry = freshRegistry();
    registerTool(registry, toolFromManifest(example()));
    const added = applyOps(
      createDefaultWorkspace('en'),
      [{ op: 'installTool', toolId: 'job-apply' }],
      {
        registry,
        locale: 'en',
      },
    );
    if (!added.ok) throw new Error(added.error);
    const result = validateWorkspace(added.config, freshRegistry());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toContain('unknown-tool');
  });

  it('cannot take the place of a built-in tool or bring its own actions', () => {
    const registry = freshRegistry();
    expect(() => registerTool(registry, { ...toolFromManifest(example()), id: 'pdf' })).toThrow(
      /built in/,
    );
    const withAction = {
      ...toolFromManifest(example()),
      actions: [registry.actions.get('pdf.merge')!],
    };
    expect(() => registerTool(registry, withAction)).toThrow(/must not add actions/);
    const { origin: _, ...builtIn } = toolFromManifest(example());
    expect(() => registerTool(registry, builtIn)).toThrow(/not a downloaded tool/);
  });

  it('finds the problems a bad manifest would cause', () => {
    const registry = freshRegistry();
    const check = (change: (m: ToolManifest) => void) => {
      const m = example();
      change(m);
      return checkToolManifest(m, registry).join('\n');
    };
    expect(check((m) => (m.id = 'pdf'))).toMatch(/built-in/);
    expect(check((m) => (m.hostApi = HOST_API + 1))).toMatch(/host API/);
    expect(check((m) => (m.workflows[0]!.id = 'other-docs'))).toMatch(/must start with job-apply-/);
    expect(check((m) => (m.workflows[0]!.steps[1]!.action = 'pdf.nothing'))).toMatch(
      /pdf\.nothing/,
    );
    expect(
      check((m) => (m.workflows[1]!.steps[3]!.params = { maxKB: -1, format: 'jpeg' })),
    ).not.toBe('');
    // 存到相册要 photos.save 权限，清单里没有声明。
    expect(
      check((m) =>
        m.workflows[1]!.steps.splice(4, 1, { id: 'save', action: 'out.saveToPhotos', params: {} }),
      ),
    ).toMatch(/photos\.save/);
  });

  it('parses downloaded bytes and checks they are the version the catalog promised', () => {
    const registry = freshRegistry();
    expect(parseToolManifest(bytes(example()), registry).id).toBe('job-apply');
    expect(() =>
      parseToolManifest(bytes(example()), registry, { id: 'job-apply', version: '2.0.0' }),
    ).toThrow(ToolDownloadError);
    expect(() => parseToolManifest(new TextEncoder().encode('{'), registry)).toThrow(/format/);
    expect(() => parseToolManifest(bytes({ ...example(), script: 'alert(1)' }), registry)).toThrow(
      /format/,
    );
  });
});

describe('signed catalog (D-178)', () => {
  const entry = {
    id: 'job-apply',
    version: '1.0.0',
    hostApi: 1,
    path: 'tools/job-apply/1.0.0.json',
    size: 1234,
    sha256: 'a'.repeat(64),
    name: { en: 'Job application', zh: '求职材料', fr: 'Job application' },
    description: { en: 'CV in one PDF.', zh: '简历合成一个 PDF。', fr: 'CV in one PDF.' },
    icon: 'person',
  } as const;
  const catalog: Catalog = {
    format: 1,
    seq: 3,
    issuedAt: '2026-10-24T08:00:00.000Z',
    tools: [{ ...entry, name: { ...entry.name }, description: { ...entry.description } }],
    revoked: ['job-apply@0.9.0'],
  };
  const key = generateSigningKey();
  const signed = () => {
    const data = bytes(catalog);
    return { data, signature: signCatalog(data, key.secretKey) };
  };

  it('accepts a catalog signed by a trusted key', () => {
    const { data, signature } = signed();
    expect(verifyCatalog(data, signature, [key.publicKey]).tools[0]!.id).toBe('job-apply');
    expect(publicKeyOf(key.secretKey)).toBe(key.publicKey);
  });

  it('rejects a changed byte, an unknown key, a bad signature and an older catalog', () => {
    const { data, signature } = signed();
    const tampered = data.slice();
    tampered[10] = tampered[10]! ^ 1;
    const code = (fn: () => unknown) => {
      try {
        fn();
        return 'accepted';
      } catch (e) {
        return (e as ToolDownloadError).code;
      }
    };
    expect(code(() => verifyCatalog(tampered, signature, [key.publicKey]))).toBe('signature');
    expect(code(() => verifyCatalog(data, signature, [generateSigningKey().publicKey]))).toBe(
      'signature',
    );
    expect(code(() => verifyCatalog(data, 'not base64!!', [key.publicKey]))).toBe('signature');
    expect(code(() => verifyCatalog(data, signature, []))).toBe('signature');
    expect(code(() => verifyCatalog(data, signature, [key.publicKey], 4))).toBe('stale');
    expect(code(() => verifyCatalog(data, signature, [key.publicKey], 3))).toBe('accepted');
  });

  it('rejects a signed catalog with a path that leaves the catalog folder', () => {
    const bad = { ...catalog, tools: [{ ...catalog.tools[0]!, path: '../secret.json' }] };
    const data = bytes(bad);
    expect(() => verifyCatalog(data, signCatalog(data, key.secretKey), [key.publicKey])).toThrow(
      /format/,
    );
  });

  it('knows revoked versions and where each manifest lives', () => {
    expect(isRevoked(catalog, 'job-apply', '0.9.0')).toBe(true);
    expect(isRevoked(catalog, 'job-apply', '1.0.0')).toBe(false);
    expect(isRevoked(null, 'job-apply', '0.9.0')).toBe(false);
    expect(toolManifestUrl('https://tools.example.com/morph/', catalog.tools[0]!)).toBe(
      'https://tools.example.com/morph/tools/job-apply/1.0.0.json',
    );
  });

  it('trusts the dev key only when asked to', () => {
    expect(trustedToolKeys(false)).not.toContain(DEV_TOOL_SIGNING_KEY);
    expect(trustedToolKeys(true)).toContain(DEV_TOOL_SIGNING_KEY);
    // 仓库里的开发私钥和代码里的开发公钥是一对。
    const secret = repoFile('tools/dev-signing-key.txt')
      .split('\n')
      .find((l) => l.trim() && !l.startsWith('#'))!;
    expect(publicKeyOf(secret)).toBe(DEV_TOOL_SIGNING_KEY);
  });

  it('compares versions by number', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
  });
});

describe('decodeUtf8', () => {
  it('decodes like TextDecoder and refuses broken bytes', () => {
    const text = 'Job 求职 ✅ 𠀋 é';
    expect(decodeUtf8(new TextEncoder().encode(text))).toBe(text);
    expect(() => decodeUtf8(Uint8Array.of(0xe6, 0xb1))).toThrow(/UTF-8/);
    expect(() => decodeUtf8(Uint8Array.of(0xc0, 0xaf))).toThrow(/UTF-8/);
    expect(() => decodeUtf8(Uint8Array.of(0xed, 0xa0, 0x80))).toThrow(/UTF-8/);
  });
});
