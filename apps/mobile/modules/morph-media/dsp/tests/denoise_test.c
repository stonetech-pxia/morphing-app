#include "MorphDenoise.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
int main(void) {
  assert(!morph_denoise_create(0)); assert(!morph_denoise_create(3));
  MorphDenoiser *s = morph_denoise_create(2); assert(s);
  float input[960] = {0}, output[960];
  for (int b=0;b<4;b++) { assert(morph_denoise_process(s,input,output)==0); for(int i=0;i<960;i++) assert(output[i]==0); }
  double before=0, after=0; unsigned int seed=1;
  for(int b=0;b<300;b++) {
    for(int i=0;i<480;i++) {seed=1664525*seed+1013904223; input[i*2]=((seed>>8)/16777216.0f-.5f)*.12f; input[i*2+1]=0;}
    assert(morph_denoise_process(s,input,output)==0);
    for(int i=0;i<480;i++) {assert(isfinite(output[i*2])); assert(fabsf(output[i*2])<=1); assert(output[i*2+1]==0); if(b>100){before+=input[i*2]*input[i*2];after+=output[i*2]*output[i*2];}}
  }
  assert(after<before*.5); morph_denoise_destroy(s);
  printf("PASS: RNNoise independent stereo states, silence, bounded finite samples; stationary noise %.2f dB\n",10*log10(after/before));
  return 0;
}
