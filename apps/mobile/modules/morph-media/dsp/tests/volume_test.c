#include "MorphDsp.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

static MorphMeter *tone(float amplitude, float gain, int shorts) {
  MorphMeter *m = morph_meter_create(48000, 2);
  assert(m);
  float f[9600]; short s[9600];
  for (int block = 0; block < 30; block++) {
    for (int i = 0; i < 4800; i++) {
      float v = amplitude * gain * sin(2 * 3.141592653589793 * 1000 * (block * 4800 + i) / 48000);
      f[i * 2] = f[i * 2 + 1] = v;
      s[i * 2] = s[i * 2 + 1] = (short)round(v * 32767);
    }
    assert((shorts ? morph_meter_add_short(m, s, 9600) : morph_meter_add_float(m, f, 9600)) == 0);
  }
  return m;
}
int main(void) {
  assert(!morph_meter_create(0, 2));
  assert(!morph_meter_create(48000, 0));
  MorphMeter *m = tone(0.1f, 1, 0);
  assert(fabs(morph_meter_peak(m) - 0.1) < 0.0001);
  assert(fabs(morph_meter_gain(m, 0, 6) - pow(10, 6.0 / 20)) < 0.0001);
  double gain = morph_meter_gain(m, 1, 0);
  MorphMeter *normal = tone(0.1f, gain, 0);
  assert(fabs(morph_meter_lufs(normal) + 16) < 0.15);
  MorphMeter *loud = tone(0.99f, 1, 0);
  assert(morph_meter_peak(loud) * morph_meter_gain(loud, 0, 24) <= pow(10, -1.0/20) + 0.00001);
  MorphMeter *quiet = tone(0.0001f, 1, 0);
  assert(morph_meter_gain(quiet, 1, 0) <= pow(10, 24.0/20) + 0.00001);
  MorphMeter *silent = tone(0, 1, 0);
  assert(morph_meter_gain(silent, 1, 0) == 1);
  MorphMeter *pcm16 = tone(0.1f, 1, 1);
  assert(fabs(morph_meter_lufs(pcm16) - morph_meter_lufs(m)) < 0.15);
  printf("PASS: native LUFS normal %.2f, manual gain, peak ceiling, silence, gain cap, PCM16/float agreement\n", morph_meter_lufs(normal));
  morph_meter_destroy(m); morph_meter_destroy(normal); morph_meter_destroy(loud);
  morph_meter_destroy(quiet); morph_meter_destroy(silent); morph_meter_destroy(pcm16);
  return 0;
}
