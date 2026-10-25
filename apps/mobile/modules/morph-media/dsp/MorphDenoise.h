#ifndef MORPH_DENOISE_H
#define MORPH_DENOISE_H
#ifdef __cplusplus
extern "C" {
#endif
/* 48kHz interleaved Float PCM [-1,1], 480 frames per call. RNNoise has 960 frames latency. */
typedef struct MorphDenoiser MorphDenoiser;
MorphDenoiser *morph_denoise_create(int channels);
int morph_denoise_process(MorphDenoiser *state, const float *input, float *output);
/* 创建时的声道数：每次 process 读写 480 × channels 个样本。 */
int morph_denoise_channels(const MorphDenoiser *state);
void morph_denoise_destroy(MorphDenoiser *state);
#ifdef __cplusplus
}
#endif
#endif
