import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { z } from 'zod';

import { createDefaultWorkspace } from './defaults';
import { applyOps } from './ops';
import type { Registry, ToolDefinition } from './registry';
import {
  IconSchema,
  IconValueSchema,
  IdSchema,
  WorkflowStepSchema,
  type Locale,
  type Page,
  type Workflow,
} from './schema';
import { validateWorkspace } from './validate';
import { PERMISSIONS } from './workflow/contract';

// 从服务器下载的工具（D-177、D-178，docs/TOOL_DOWNLOAD_DESIGN.md）。
// 第一步只有数据工具：清单里是工具页的文字和快捷操作，只组合已有的动作，不含任何代码。
// 目录（catalog.json）用 Ed25519 签名；清单按目录里的 SHA-256 校验。App 和计划服务共用这里的校验。

ed.hashes.sha512 = sha512;

// Hermes 和 Node 都有 atob / btoa（App 里已经在用）；core 的 lib 只有 ES2022，这里补上类型。
declare function atob(data: string): string;
declare function btoa(data: string): string;

/**
 * 把 UTF-8 字节解成字符串（不用 TextDecoder：Hermes 上不一定有）。不合法的字节直接报错，
 * 所以解出来再编码回去和原来的字节完全一样（目录的签名靠这一点）。
 */
export function decodeUtf8(bytes: Uint8Array): string {
  const parts: string[] = [];
  const cont = (i: number) => {
    const b = bytes[i];
    if (b === undefined || (b & 0xc0) !== 0x80) throw new Error('invalid UTF-8');
    return b & 0x3f;
  };
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!;
    let cp: number;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b >= 0xc2 && b < 0xe0) {
      cp = ((b & 0x1f) << 6) | cont(i + 1);
      i += 2;
    } else if (b >= 0xe0 && b < 0xf0) {
      cp = ((b & 0x0f) << 12) | (cont(i + 1) << 6) | cont(i + 2);
      if (cp < 0x800 || (cp >= 0xd800 && cp < 0xe000)) throw new Error('invalid UTF-8');
      i += 3;
    } else if (b >= 0xf0 && b < 0xf5) {
      cp = ((b & 0x07) << 18) | (cont(i + 1) << 12) | (cont(i + 2) << 6) | cont(i + 3);
      if (cp < 0x10000 || cp > 0x10ffff) throw new Error('invalid UTF-8');
      i += 4;
    } else {
      throw new Error('invalid UTF-8');
    }
    parts.push(String.fromCodePoint(cp));
  }
  return parts.join('');
}

/** 宿主能力级别（§7）：App 每加一样下载的工具能用的能力就加 1。 */
export const HOST_API = 1;

/** 一个工具清单的大小上限（数据工具只有文字和步骤）。 */
export const MAX_TOOL_MANIFEST_BYTES = 256 * 1024;

const VersionSchema = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/, 'version must be x.y.z');

/** 比较两个 x.y.z 版本号：a 更新时返回正数。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const localized = (max: number) =>
  z.strictObject({
    en: z.string().trim().min(1).max(max),
    zh: z.string().trim().min(1).max(max),
  });

export const ToolManifestSchema = z.strictObject({
  format: z.literal(1),
  id: IdSchema,
  version: VersionSchema,
  hostApi: z.number().int().min(1),
  /** 4.7.5：只发布 4+ 的工具。 */
  ageRating: z.literal('4+'),
  name: localized(40),
  description: localized(200),
  /** 工具页标题下面的一段说明。 */
  intro: localized(300),
  icon: IconSchema,
  aliases: z.array(z.string().trim().min(1).max(40)).max(20),
  permissions: z.array(z.enum(PERMISSIONS)),
  workflows: z
    .array(
      z.strictObject({
        id: IdSchema,
        name: localized(40),
        icon: IconValueSchema.optional(),
        steps: z.array(WorkflowStepSchema).min(1),
      }),
    )
    .min(1)
    .max(12),
  /** 工具页最下面的文件列表（可选）。 */
  fileList: z
    .strictObject({
      title: localized(40),
      limit: z.number().int().min(1).max(50),
      mimeType: z.enum(['application/pdf', 'image/*', 'video/*', 'audio/*']).optional(),
    })
    .optional(),
});
export type ToolManifest = z.infer<typeof ToolManifestSchema>;

const pick = (locale: Locale, text: { en: string; zh: string }) => text[locale];

/** 把清单变成注册表里的工具：工具页和 simpleTool 的排法一样（标题、说明、每个快捷操作一个运行卡片）。 */
export function toolFromManifest(manifest: ToolManifest): ToolDefinition {
  const pageId = `tool-${manifest.id}`;
  const createWorkflows = (locale: Locale): Workflow[] =>
    manifest.workflows.map((wf) => ({
      id: wf.id,
      name: pick(locale, wf.name),
      ...(wf.icon ? { icon: wf.icon } : {}),
      toolId: manifest.id,
      steps: JSON.parse(JSON.stringify(wf.steps)) as Workflow['steps'],
    }));
  const createPage = (locale: Locale): Page => ({
    id: pageId,
    title: pick(locale, manifest.name),
    icon: manifest.icon,
    toolId: manifest.id,
    components: [
      {
        id: `${manifest.id}-header`,
        type: 'header',
        props: { title: pick(locale, manifest.name) },
      },
      { id: `${manifest.id}-intro`, type: 'text', props: { text: pick(locale, manifest.intro) } },
      ...manifest.workflows.map((wf) => ({
        id: `${wf.id}-runner`,
        type: 'workflowRunner' as const,
        props: { workflowId: wf.id },
      })),
      ...(manifest.fileList
        ? [
            {
              id: `${manifest.id}-files`,
              type: 'fileList' as const,
              props: {
                title: pick(locale, manifest.fileList.title),
                limit: manifest.fileList.limit,
                ...(manifest.fileList.mimeType ? { mimeType: manifest.fileList.mimeType } : {}),
              },
            },
          ]
        : []),
    ],
  });
  return {
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    icon: manifest.icon,
    aliases: manifest.aliases.map((a) => a.toLowerCase()),
    permissions: manifest.permissions,
    actions: [],
    createPage,
    createWorkflows,
    origin: 'download',
  };
}

/**
 * 检查一个清单能不能装进这个注册表：不能和内置工具重名、App 的能力级别够用、快捷操作的 id 以工具 id 开头，
 * 而且在空白的工作空间里（两种语言）添加后能通过 validateWorkspace（动作、参数、类型链、权限）。
 */
export function checkToolManifest(manifest: ToolManifest, registry: Registry): string[] {
  const problems: string[] = [];
  const existing = registry.tools.get(manifest.id);
  if (existing && existing.origin !== 'download')
    problems.push(`${manifest.id} is a built-in tool`);
  if (manifest.hostApi > HOST_API) {
    problems.push(`needs host API ${manifest.hostApi}, this app has ${HOST_API}`);
  }
  const ids = manifest.workflows.map((wf) => wf.id);
  for (const id of ids) {
    if (!id.startsWith(`${manifest.id}-`))
      problems.push(`workflow ${id} must start with ${manifest.id}-`);
  }
  if (new Set(ids).size !== ids.length) problems.push('duplicate workflow ids');
  if (problems.length > 0) return problems;

  const tool = toolFromManifest(manifest);
  const scratch: Registry = {
    tools: new Map([...registry.tools, [tool.id, tool]]),
    actions: registry.actions,
    actionOwner: registry.actionOwner,
  };
  for (const locale of ['en', 'zh'] as const) {
    const applied = applyOps(
      createDefaultWorkspace(locale),
      [{ op: 'installTool', toolId: tool.id }],
      { registry: scratch, locale },
    );
    if (!applied.ok) {
      problems.push(`${locale}: ${applied.error}`);
      continue;
    }
    const valid = validateWorkspace(applied.config, scratch);
    if (!valid.ok) problems.push(...valid.issues.map((i) => `${locale}: ${i.message}`));
  }
  return problems;
}

/** 解析并检查一个下载的清单；不对就抛出 ToolDownloadError。 */
export function parseToolManifest(
  bytes: Uint8Array,
  registry: Registry,
  expected?: { id: string; version: string },
): ToolManifest {
  let json: unknown;
  try {
    json = JSON.parse(decodeUtf8(bytes));
  } catch {
    throw new ToolDownloadError('format', 'manifest is not JSON');
  }
  const parsed = ToolManifestSchema.safeParse(json);
  if (!parsed.success) throw new ToolDownloadError('format', parsed.error.issues[0]?.message);
  const manifest = parsed.data;
  if (expected && (manifest.id !== expected.id || manifest.version !== expected.version)) {
    throw new ToolDownloadError('format', `expected ${expected.id}@${expected.version}`);
  }
  const problems = checkToolManifest(manifest, registry);
  if (problems.length > 0) throw new ToolDownloadError('invalid', problems.join('; '));
  return manifest;
}

// ---- 签名的目录 ----

export const CatalogEntrySchema = z.strictObject({
  id: IdSchema,
  version: VersionSchema,
  hostApi: z.number().int().min(1),
  /** 清单相对于目录地址的路径，例如 tools/rental/1.0.0.json。 */
  path: z
    .string()
    .regex(/^[a-z0-9][a-z0-9/._-]*\.json$/, 'path must be a relative .json path')
    .refine((p) => !p.includes('..'), 'path must not contain ..'),
  size: z.number().int().min(1).max(MAX_TOOL_MANIFEST_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  // 没下载之前，目录页显示这些。
  name: localized(40),
  description: localized(200),
  icon: IconSchema,
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const CatalogSchema = z.strictObject({
  format: z.literal(1),
  /** 每发布一次加 1；App 不接受比上次看到的更小的（防止拿旧目录撤掉停用）。 */
  seq: z.number().int().min(1),
  issuedAt: z.iso.datetime(),
  /** 每个工具的最新版本（停用的也留在这里，否则已经添加了它的配置会校验不过）。 */
  tools: z.array(CatalogEntrySchema).max(500),
  /** 停用的版本：「id@version」。 */
  revoked: z.array(z.string().regex(/^[a-z0-9-]+@\d+\.\d+\.\d+$/)).max(1000),
});
export type Catalog = z.infer<typeof CatalogSchema>;

export class ToolDownloadError extends Error {
  constructor(
    readonly code:
      | 'signature'
      | 'format'
      | 'stale'
      | 'download'
      | 'size'
      | 'hash'
      | 'invalid'
      | 'downgrade'
      | 'host',
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromBase64 = (text: string) =>
  Uint8Array.from(atob(text.trim()), (c: string) => c.charCodeAt(0));

/** 用私钥给目录签名（发布脚本和测试用），返回 base64 的签名。 */
export function signCatalog(bytes: Uint8Array, secretKeyBase64: string): string {
  return toBase64(ed.sign(bytes, fromBase64(secretKeyBase64)));
}

/** 私钥对应的公钥（base64）。 */
export function publicKeyOf(secretKeyBase64: string): string {
  return toBase64(ed.getPublicKey(fromBase64(secretKeyBase64)));
}

/** 新的一对密钥（base64）。 */
export function generateSigningKey(): { secretKey: string; publicKey: string } {
  const { secretKey, publicKey } = ed.keygen();
  return { secretKey: toBase64(secretKey), publicKey: toBase64(publicKey) };
}

/**
 * 验证目录的签名（任何一个受信任的公钥验得过就行），再解析。
 * minSeq：上次接受过的目录的 seq，比它小就拒绝。
 */
export function verifyCatalog(
  bytes: Uint8Array,
  signatureBase64: string,
  trustedKeys: readonly string[],
  minSeq = 0,
): Catalog {
  let signature: Uint8Array;
  try {
    signature = fromBase64(signatureBase64);
  } catch {
    throw new ToolDownloadError('signature', 'not base64');
  }
  const ok = trustedKeys.some((key) => {
    try {
      return ed.verify(signature, bytes, fromBase64(key));
    } catch {
      return false;
    }
  });
  if (!ok) throw new ToolDownloadError('signature');
  let json: unknown;
  try {
    json = JSON.parse(decodeUtf8(bytes));
  } catch {
    throw new ToolDownloadError('format', 'catalog is not JSON');
  }
  const parsed = CatalogSchema.safeParse(json);
  if (!parsed.success) throw new ToolDownloadError('format', parsed.error.issues[0]?.message);
  if (parsed.data.seq < minSeq)
    throw new ToolDownloadError('stale', `seq ${parsed.data.seq} < ${minSeq}`);
  return parsed.data;
}

export const isRevoked = (catalog: Catalog | null, id: string, version: string) =>
  catalog?.revoked.includes(`${id}@${version}`) ?? false;

/** 目录里一个工具的清单地址（相对于目录所在的地址）。 */
export function toolManifestUrl(catalogBaseUrl: string, entry: CatalogEntry): string {
  return `${catalogBaseUrl.replace(/\/+$/, '')}/${entry.path}`;
}
