#include "MorphDenoise.h"
#include "rnnoise/include/rnnoise.h"
#include <math.h>
#include <stdlib.h>
struct MorphDenoiser { int channels; DenoiseState *states[2]; };
void morph_denoise_destroy(MorphDenoiser *s) {
  if (!s) return;
  for (int c = 0; c < s->channels; c++) if (s->states[c]) rnnoise_destroy(s->states[c]);
  free(s);
}
MorphDenoiser *morph_denoise_create(int channels) {
  if (channels < 1 || channels > 2) return NULL;
  MorphDenoiser *s = calloc(1, sizeof(*s));
  if (!s) return NULL;
  s->channels = channels;
  for (int c = 0; c < channels; c++) if (!(s->states[c] = rnnoise_create(NULL))) { morph_denoise_destroy(s); return NULL; }
  return s;
}
int morph_denoise_channels(const MorphDenoiser *s) { return s ? s->channels : 0; }
int morph_denoise_process(MorphDenoiser *s, const float *in, float *out) {
  if (!s || !in || !out) return -1;
  float input[480], output[480];
  for (int c = 0; c < s->channels; c++) {
    for (int i = 0; i < 480; i++) { float v = in[i*s->channels+c]; input[i] = isfinite(v) ? fmaxf(-1, fminf(1, v))*32768 : 0; }
    rnnoise_process_frame(s->states[c], output, input);
    for (int i = 0; i < 480; i++) out[i*s->channels+c] = fmaxf(-1, fminf(1, output[i]/32768));
  }
  return 0;
}
