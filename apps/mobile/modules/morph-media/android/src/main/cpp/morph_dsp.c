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
