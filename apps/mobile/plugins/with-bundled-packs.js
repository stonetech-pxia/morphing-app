// 随 App 打包的扩展包（D-510）：prebuild 时按 packages/core/src/packs.ts 的清单下载 BUNDLED_PACKS 里的文件，
// 逐个校验大小和 SHA-256（缓存在 node_modules/.cache/morph-bundled-packs，下次 prebuild 不再下载），
// 放进 App 的 packs/<id>/<version>/：iOS 是 .app 里的文件夹（Xcode 里的 folder reference），
// Android 是 app/src/main/assets/packs。App 第一次用到时复制到 documentDirectory/packs（src/packs/store.ts）。
// 放在我们自己服务器上的扩展包（展平、版面，D-274）要 EXPO_PUBLIC_MORPH_PACKS_URL；没配置时跳过（App 也不提示下载它们）。
// 下载失败或大小、哈希不对时 prebuild 失败，不会打出少了扩展包的 App。
const { Buffer } = require('node:buffer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

/** 仓库根目录（projectRoot 是 apps/mobile）。 */
const repoOf = (projectRoot) => path.resolve(projectRoot, '../..');

/** 清单是 TypeScript：Node 22.18 起能直接读（去掉类型）。只在 prebuild 时读。 */
function manifest(repo) {
  try {
    return require(path.join(repo, 'packages/core/src/packs.ts'));
  } catch (e) {
    throw new Error(
      `[with-bundled-packs] cannot read packages/core/src/packs.ts (needs Node 22.18+): ${e.message}`,
    );
  }
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** 一个文件：缓存里有而且哈希对就用缓存，否则下载、校验后放进缓存。返回缓存里的路径。 */
async function fetchFile(repo, pack, file, url) {
  const cached = path.join(
    repo,
    'node_modules/.cache/morph-bundled-packs',
    pack.id,
    pack.version,
    file.path,
  );
  if (fs.existsSync(cached) && sha256(fs.readFileSync(cached)) === file.sha256) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`[with-bundled-packs] ${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
    throw new Error(`[with-bundled-packs] ${pack.id}/${file.path}: size or SHA-256 does not match`);
  }
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, bytes);
  return cached;
}

/** 把这个平台要带的扩展包放进 dest（先清空，旧版本不留）。 */
async function bundlePacks(repo, platform, dest) {
  const { BUNDLED_PACKS, packById, packFileUrl } = manifest(repo);
  const base = process.env.EXPO_PUBLIC_MORPH_PACKS_URL;
  fs.rmSync(dest, { recursive: true, force: true });
  let total = 0;
  for (const id of BUNDLED_PACKS[platform]) {
    const pack = packById(id);
    if (!pack) throw new Error(`[with-bundled-packs] unknown pack ${id}`);
    const urls = pack.files.map((file) => packFileUrl(file, base));
    if (urls.some((url) => url === null)) {
      console.warn(
        `[with-bundled-packs] ${id} skipped: EXPO_PUBLIC_MORPH_PACKS_URL is not set (the app will not offer it either)`,
      );
      continue;
    }
    for (const [i, file] of pack.files.entries()) {
      const cached = await fetchFile(repo, pack, file, urls[i]);
      const target = path.join(dest, pack.id, pack.version, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(cached, target);
      total += file.size;
    }
  }
  console.log(
    `[with-bundled-packs] ${platform}: ${(total / 1024 / 1024).toFixed(1)} MB in ${dest}`,
  );
}

const withIosPacks = (config) =>
  withXcodeProject(
    withDangerousMod(config, [
      'ios',
      async (next) => {
        const { platformProjectRoot, projectName, projectRoot } = next.modRequest;
        const dest = path.join(platformProjectRoot, projectName, 'packs');
        await bundlePacks(repoOf(projectRoot), 'ios', dest);
        return next;
      },
    ]),
    (next) => {
      // 整个文件夹作为 folder reference 进 App 的资源（.app/packs/...），文件夹里的结构原样保留。
      const project = next.modResults;
      const name = next.modRequest.projectName;
      const group = project.findPBXGroupKey({ name }) ?? project.findPBXGroupKey({ path: name });
      if (!group) throw new Error(`[with-bundled-packs] Xcode group ${name} not found`);
      const file = project.addResourceFile(
        `${name}/packs`,
        { lastKnownFileType: 'folder', target: project.getFirstTarget().uuid },
        group,
      );
      // 已经加过（不带 --clean 的 prebuild）时返回 false。文件夹没有编码，去掉 xcode 库写成「undefined」的空字段。
      const ref = file && project.pbxFileReferenceSection()[file.fileRef];
      for (const key of Object.keys(ref ?? {})) if (ref[key] === undefined) delete ref[key];
      return next;
    },
  );

const withAndroidPacks = (config) =>
  withDangerousMod(config, [
    'android',
    async (next) => {
      const { platformProjectRoot, projectRoot } = next.modRequest;
      const dest = path.join(platformProjectRoot, 'app/src/main/assets/packs');
      await bundlePacks(repoOf(projectRoot), 'android', dest);
      return next;
    },
  ]);

module.exports = (config) => withAndroidPacks(withIosPacks(config));
