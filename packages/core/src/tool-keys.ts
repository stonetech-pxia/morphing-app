// 给工具目录签名的公钥（D-178）。私钥由创始人离线保管，从不进仓库、不放在任何服务器上。
// 换钥匙时先把新公钥加进来、发一版 App，再用新私钥签名，最后去掉旧公钥。

/**
 * 正式的公钥（base64），2026-10-24 创始人用 `npm run tools -- keygen --print` 生成。
 * 私钥在创始人的密码管理器里（主用）和另一个地方（备用），签名时粘贴（`sign --prompt`）。
 */
export const TOOL_SIGNING_KEYS: readonly string[] = [
  'L9//DTdHRvM4ria8sp1zaRkvo08FcqNPqMFtf2cN1GE=', // 主用
  'pnxE8rb/OCWHkm+8ZUT2IHdRHtwwfbcAR1Mq9qD5P6I=', // 备用
];

/**
 * 开发用的公钥：私钥就在仓库里（tools/dev-signing-key.txt），谁都能用它签名，
 * 所以只有开发版 App（__DEV__）和设置了 MORPH_TOOLS_DEV_KEY=1 的计划服务才信任它。
 */
export const DEV_TOOL_SIGNING_KEY = 'ar/xNDIgr1lk/vL+KkGkt9lcuPgCZs9UFDDMn5Yp9Fw=';

/** 这次运行信任哪些公钥。 */
export const trustedToolKeys = (dev: boolean): readonly string[] =>
  dev ? [...TOOL_SIGNING_KEYS, DEV_TOOL_SIGNING_KEY] : TOOL_SIGNING_KEYS;
