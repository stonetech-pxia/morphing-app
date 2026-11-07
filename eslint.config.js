// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    // 从仓库根目录运行时，让 import 插件按各工作区的 tsconfig 解析路径别名（如 @/）。
    settings: {
      'import/resolver': {
        typescript: { project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'] },
      },
    },
  },
  {
    // 存储这一层不依赖渲染器、外壳、编辑页面和动作执行器（R11）：它们依赖存储，反过来的话，
    // 一个底层文件会带进整套执行器和平台依赖，单独导入验证不了。存储要用的小工具放在叶子模块
    // runtime/ids.ts、mime.ts、pdf-errors.ts、platform.ts。
    files: ['apps/mobile/src/storage/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/renderer/**',
                '**/shell/**',
                '**/editing/**',
                '**/runtime/runner',
                '**/runtime/actions/**',
              ],
              message:
                'storage 不依赖渲染器、外壳、编辑页面和动作执行器；共用的小函数放进 runtime/ids.ts、mime.ts、pdf-errors.ts 这样的叶子模块。',
            },
          ],
        },
      ],
    },
  },
  {
    // .claude/worktrees 是其他会话的工作目录，不属于这个检出。
    // apps/mobile/ios、android 由 expo prebuild 生成（CNG，不进 git）。
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/coverage/**',
      '.claude/**',
      'apps/mobile/ios/**',
      'apps/mobile/android/**',
    ],
  },
]);
