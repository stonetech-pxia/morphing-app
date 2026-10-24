// MP3 编码的 JNI（D-183）：Mp3Encoder.kt 交来交错的 16 位 PCM，LAME 编成 MP3 帧交回去，写文件在 Kotlin 里。
#include <jni.h>
#include <stdint.h>

#include "lame.h"

#define EXPORT __attribute__((visibility("default")))

/** 返回编码器句柄；参数不被 LAME 接受时返回 0。quality 用 LAME 的 2（好，比默认的 5 慢一点）。 */
EXPORT JNIEXPORT jlong JNICALL
Java_expo_modules_morphmedia_Mp3Encoder_nativeInit(JNIEnv *env, jclass cls, jint sampleRate, jint channels,
                                                   jint kbps) {
  lame_t lame = lame_init();
  if (!lame) return 0;
  lame_set_in_samplerate(lame, sampleRate);
  lame_set_num_channels(lame, channels);
  lame_set_mode(lame, channels == 1 ? MONO : JOINT_STEREO);
  lame_set_brate(lame, kbps);
  lame_set_quality(lame, 2);
  if (lame_init_params(lame) < 0) {
    lame_close(lame);
    return 0;
  }
  return (jlong)(intptr_t)lame;
}

/** frames 帧交错样本 → MP3 字节，返回写进 out 的字节数（负数是 LAME 的错误码）。 */
EXPORT JNIEXPORT jint JNICALL
Java_expo_modules_morphmedia_Mp3Encoder_nativeEncode(JNIEnv *env, jclass cls, jlong handle, jshortArray pcm,
                                                     jint frames, jbyteArray out) {
  lame_t lame = (lame_t)(intptr_t)handle;
  jshort *samples = (*env)->GetShortArrayElements(env, pcm, NULL);
  jbyte *bytes = (*env)->GetByteArrayElements(env, out, NULL);
  int size = (*env)->GetArrayLength(env, out);
  int written = lame_get_num_channels(lame) == 1
                    ? lame_encode_buffer(lame, samples, samples, frames, (unsigned char *)bytes, size)
                    : lame_encode_buffer_interleaved(lame, samples, frames, (unsigned char *)bytes, size);
  (*env)->ReleaseByteArrayElements(env, out, bytes, 0);
  (*env)->ReleaseShortArrayElements(env, pcm, samples, JNI_ABORT);
  return written;
}

/** 编码器里剩下的样本 → 最后几帧，返回字节数。 */
EXPORT JNIEXPORT jint JNICALL
Java_expo_modules_morphmedia_Mp3Encoder_nativeFlush(JNIEnv *env, jclass cls, jlong handle, jbyteArray out) {
  lame_t lame = (lame_t)(intptr_t)handle;
  jbyte *bytes = (*env)->GetByteArrayElements(env, out, NULL);
  int size = (*env)->GetArrayLength(env, out);
  int written = lame_encode_flush(lame, (unsigned char *)bytes, size);
  (*env)->ReleaseByteArrayElements(env, out, bytes, 0);
  return written;
}

EXPORT JNIEXPORT void JNICALL
Java_expo_modules_morphmedia_Mp3Encoder_nativeClose(JNIEnv *env, jclass cls, jlong handle) {
  lame_close((lame_t)(intptr_t)handle);
}
