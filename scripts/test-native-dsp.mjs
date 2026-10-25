// 直接测试两端共用的 C 算法；只在系统临时目录编译和运行生成的测试程序。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = 'apps/mobile/modules/morph-media/dsp';
const dir = mkdtempSync(path.join(tmpdir(), 'morph-dsp-test-'));
try {
  const binary = path.join(dir, 'volume-test');
  const compile = spawnSync(
    process.env.CC || 'cc',
    [
      '-O2',
      '-I',
      root,
      '-I',
      `${root}/ebur128/queue`,
      `${root}/tests/volume_test.c`,
      `${root}/MorphDsp.c`,
      `${root}/ebur128/ebur128.c`,
      '-lm',
      '-o',
      binary,
    ],
    { encoding: 'utf8' },
  );
  if (compile.status !== 0)
    throw new Error(compile.error?.message || compile.stderr || 'Native DSP compilation failed');
  const test = spawnSync(binary, [], { encoding: 'utf8' });
  if (test.stdout) process.stdout.write(test.stdout);
  if (test.status !== 0) throw new Error(test.stderr || 'Native DSP assertions failed');
  const denoiseBinary = path.join(dir, 'denoise-test');
  const names = [
    'denoise',
    'rnn',
    'pitch',
    'kiss_fft',
    'celt_lpc',
    'nnet',
    'nnet_default',
    'parse_lpcnet_weights',
    'rnnoise_data',
    'rnnoise_tables',
  ];
  const denoiseCompile = spawnSync(
    process.env.CC || 'cc',
    [
      '-O2',
      '-DDISABLE_DEBUG_FLOAT',
      '-I',
      root,
      '-I',
      `${root}/rnnoise/include`,
      '-I',
      `${root}/rnnoise/src`,
      `${root}/tests/denoise_test.c`,
      `${root}/MorphDenoise.c`,
      ...names.map((name) => `${root}/rnnoise/src/${name}.c`),
      '-lm',
      '-o',
      denoiseBinary,
    ],
    { encoding: 'utf8' },
  );
  if (denoiseCompile.status !== 0)
    throw new Error(
      denoiseCompile.error?.message || denoiseCompile.stderr || 'RNNoise compilation failed',
    );
  const denoiseTest = spawnSync(denoiseBinary, [], { encoding: 'utf8' });
  if (denoiseTest.stdout) process.stdout.write(denoiseTest.stdout);
  if (denoiseTest.status !== 0) throw new Error(denoiseTest.stderr || 'RNNoise assertions failed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
