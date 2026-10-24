import { resolve } from 'node:path';

import { generateSigningKey, trustedToolKeys } from '@morph/core';

import {
  buildCatalog,
  keygen,
  revokeVersion,
  signCatalogFile,
  signCatalogWithKey,
  verifyOutput,
} from '../src/publish';

// 发布下载的工具（docs/TOOL_DOWNLOAD_DESIGN.md §13）。在仓库根目录运行：
//   npm run tools -- build <tools 目录> <输出目录>        检查清单，生成未签名的 catalog.json
//   npm run tools -- sign <输出目录> --prompt             签名：粘贴私钥（不显示、不写文件）
//   npm run tools -- sign <输出目录> <私钥文件>           签名：从文件读私钥（开发密钥 tools/dev-signing-key.txt）
//   npm run tools -- revoke <输出目录> <id@version>       停用一个版本（之后重新签名）
//   npm run tools -- verify <输出目录> [--dev]            上传前检查（--dev：也信任开发公钥）
//   npm run tools -- keygen --print                       生成正式密钥，只在终端里显示一次（存进密码管理器）
//   npm run tools -- keygen <私钥文件>                    生成正式密钥，写进文件（U 盘、加密磁盘映像）
// 正式公钥填进 packages/core/src/tool-keys.ts。

const root = resolve(import.meta.dirname, '../../..');
const [command, ...args] = process.argv.slice(2);
const path = (p: string | undefined) => {
  if (!p)
    throw new Error('missing argument; see the usage at the top of apps/api/scripts/tools.ts');
  return resolve(root, p);
};

/** 读一行不回显的输入（粘贴私钥用）；不是终端时（管道）读完整个标准输入。 */
async function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let data = '';
    for await (const chunk of stdin) data += String(chunk);
    return data.trim();
  }
  process.stdout.write(question);
  return new Promise((done) => {
    let input = '';
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          done(input.trim());
          return;
        }
        if (c === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        input = c === '\u007f' ? input.slice(0, -1) : input + c;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

try {
  switch (command) {
    case 'build': {
      const catalog = buildCatalog(path(args[0]), path(args[1]));
      console.log(
        `catalog seq ${catalog.seq}: ${catalog.tools.map((e) => `${e.id}@${e.version}`).join(', ')}`,
      );
      console.log('还没有签名：npm run tools -- sign <输出目录> --prompt');
      break;
    }
    case 'sign': {
      const out = path(args[0]);
      const publicKey =
        args[1] === '--prompt'
          ? signCatalogWithKey(out, await askHidden('粘贴私钥后按回车（不会显示）：'))
          : signCatalogFile(out, path(args[1]));
      console.log(`已签名，公钥 ${publicKey}`);
      break;
    }
    case 'revoke': {
      const catalog = revokeVersion(path(args[0]), args[1] ?? '');
      console.log(`catalog seq ${catalog.seq}，停用：${catalog.revoked.join(', ')}；记得重新签名`);
      break;
    }
    case 'verify': {
      const catalog = verifyOutput(path(args[0]), trustedToolKeys(args.includes('--dev')));
      console.log(`签名、大小和哈希都对：seq ${catalog.seq}，${catalog.tools.length} 个工具`);
      break;
    }
    case 'keygen': {
      if (args[0] === '--print') {
        const { secretKey, publicKey } = generateSigningKey();
        console.log('私钥（只显示这一次。存进密码管理器，然后关掉这个终端窗口；不要发给任何人）：');
        console.log(secretKey);
        console.log('公钥（填进 packages/core/src/tool-keys.ts，可以公开）：');
        console.log(publicKey);
        break;
      }
      console.log(
        `私钥已写进 ${args[0]}。公钥（填进 packages/core/src/tool-keys.ts）：\n${keygen(path(args[0]))}`,
      );
      break;
    }
    default:
      throw new Error('commands: build, sign, revoke, verify, keygen');
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
