#include <jni.h>
#include <stdint.h>
#include "MorphDsp.h"

JNIEXPORT jlong JNICALL Java_expo_modules_morphmedia_AudioDsp_nativeCreate(JNIEnv *e, jclass c, jint rate, jint channels) {
  return (jlong)(intptr_t)morph_meter_create((unsigned long)rate, (unsigned int)channels);
}
JNIEXPORT jint JNICALL Java_expo_modules_morphmedia_AudioDsp_nativeAdd(JNIEnv *e, jclass c, jlong handle, jshortArray pcm, jint count) {
  if (!handle || count < 0 || count > (*e)->GetArrayLength(e, pcm)) return -1;
  jshort *samples = (*e)->GetShortArrayElements(e, pcm, NULL);
  if (!samples) return -1;
  int result = morph_meter_add_short((MorphMeter *)(intptr_t)handle, samples, (size_t)count);
  (*e)->ReleaseShortArrayElements(e, pcm, samples, JNI_ABORT);
  return result;
}
JNIEXPORT jdouble JNICALL Java_expo_modules_morphmedia_AudioDsp_nativeGain(JNIEnv *e, jclass c, jlong handle, jboolean automatic, jdouble db) {
  return morph_meter_gain((MorphMeter *)(intptr_t)handle, automatic, db);
}
JNIEXPORT void JNICALL Java_expo_modules_morphmedia_AudioDsp_nativeDestroy(JNIEnv *e, jclass c, jlong handle) {
  morph_meter_destroy((MorphMeter *)(intptr_t)handle);
}

JNIEXPORT jlong JNICALL Java_expo_modules_morphmedia_AudioDsp_nativeDenoiseCreate(JNIEnv *e, jclass c, jint channels) {
  return (jlong)(intptr_t)morph_denoise_create(channels);
}
JNIEXPORT jint JNICALL Java_expo_modules_morphmedia_AudioDsp_nativeDenoise(JNIEnv *e, jclass c, jlong handle, jfloatArray input, jfloatArray output) {
  jsize n = (*e)->GetArrayLength(e, input);
  // 长度必须正好是 480 × 创建时的声道数，否则 C 里会越界读写。
  if (!handle || n != 480 * morph_denoise_channels((MorphDenoiser *)(intptr_t)handle) ||
      (*e)->GetArrayLength(e, output) != n) return -1;
  jfloat *in = (*e)->GetFloatArrayElements(e, input, NULL);
  if (!in) return -1;
  jfloat *out = (*e)->GetFloatArrayElements(e, output, NULL);
  if (!out) { (*e)->ReleaseFloatArrayElements(e,input,in,JNI_ABORT); return -1; }
  int result = morph_denoise_process((MorphDenoiser *)(intptr_t)handle,in,out);
  (*e)->ReleaseFloatArrayElements(e,input,in,JNI_ABORT);
  (*e)->ReleaseFloatArrayElements(e,output,out,0);
  return result;
}
JNIEXPORT void JNICALL Java_expo_modules_morphmedia_AudioDsp_nativeDenoiseDestroy(JNIEnv *e, jclass c, jlong handle) {
  morph_denoise_destroy((MorphDenoiser *)(intptr_t)handle);
}
