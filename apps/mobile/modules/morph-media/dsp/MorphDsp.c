#include "MorphDsp.h"
#include "ebur128/ebur128.h"
#include <math.h>
#include <stdlib.h>

struct MorphMeter { ebur128_state *state; unsigned int channels; };
MorphMeter *morph_meter_create(unsigned long rate, unsigned int channels) {
  if (rate < 8000 || rate > 192000 || channels < 1 || channels > 8) return NULL;
  MorphMeter *m = calloc(1, sizeof(*m));
  if (!m) return NULL;
  m->state = ebur128_init(channels, rate, EBUR128_MODE_I | EBUR128_MODE_SAMPLE_PEAK | EBUR128_MODE_HISTOGRAM);
  if (!m->state) { free(m); return NULL; }
  m->channels = channels;
  return m;
}
int morph_meter_add_float(MorphMeter *m, const float *s, size_t n) {
  return m && s && n % m->channels == 0 ? ebur128_add_frames_float(m->state, s, n / m->channels) : -1;
}
int morph_meter_add_short(MorphMeter *m, const short *s, size_t n) {
  return m && s && n % m->channels == 0 ? ebur128_add_frames_short(m->state, s, n / m->channels) : -1;
}
double morph_meter_lufs(MorphMeter *m) {
  double lufs = -INFINITY;
  if (m) ebur128_loudness_global(m->state, &lufs);
  return lufs;
}
double morph_meter_peak(MorphMeter *m) {
  double peak = 0;
  if (!m) return peak;
  for (unsigned int c = 0; c < m->channels; c++) { double p = 0; ebur128_sample_peak(m->state, c, &p); if (p > peak) peak = p; }
  return peak;
}
double morph_meter_gain(MorphMeter *m, int automatic, double db) {
  const double peak = morph_meter_peak(m);
  if (!(peak > 0) || !isfinite(peak)) return 1;
  double change = db;
  if (automatic) { const double loudness = morph_meter_lufs(m); change = isfinite(loudness) ? -16 - loudness : 0; }
  if (!isfinite(change)) change = 0;
  change = fmax(-24, fmin(24, change));
  return fmin(pow(10, change / 20), pow(10, -1.0 / 20) / peak);
}
void morph_meter_destroy(MorphMeter *m) { if (m) { ebur128_destroy(&m->state); free(m); } }
