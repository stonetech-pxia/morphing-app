#ifndef MORPH_DSP_H
#define MORPH_DSP_H
#include <stddef.h>
#include "MorphDenoise.h"
#ifdef __cplusplus
extern "C" {
#endif
/* LUFS 统计逐块进行；状态只有固定大小的响度直方图，不保存录音内容。 */
typedef struct MorphMeter MorphMeter;
MorphMeter *morph_meter_create(unsigned long rate, unsigned int channels);
int morph_meter_add_float(MorphMeter *meter, const float *samples, size_t count);
int morph_meter_add_short(MorphMeter *meter, const short *samples, size_t count);
double morph_meter_lufs(MorphMeter *meter);
double morph_meter_peak(MorphMeter *meter);
/* 自动目标 -16 LUFS；手动增益也限制真峰值至 -1 dBTP，最大放大 24 dB。 */
double morph_meter_gain(MorphMeter *meter, int automatic, double db);
void morph_meter_destroy(MorphMeter *meter);
#ifdef __cplusplus
}
#endif
#endif
