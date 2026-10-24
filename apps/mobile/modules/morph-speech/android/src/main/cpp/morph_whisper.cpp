// whisper.cpp 的 JNI 接口（D-151），给 WhisperNative.kt 用。
// 不从 whisper 的回调里调 JNI（中止回调在 ggml 的工作线程上跑）：进度和取消都是原子变量，Kotlin 轮询。
// 识别出的文字只返回给 App，不写日志。

#include <jni.h>

#include <atomic>
#include <cstring>
#include <mutex>
#include <string>

#include "ggml-backend.h"
#include "whisper.h"

namespace {

struct Session {
  whisper_context *ctx = nullptr;
  std::string vad_path;
  std::atomic<bool> cancel{false};
  std::atomic<int> progress{0};
};

std::once_flag backends_once;
std::string backend_name = "builtin";

// arm64 上 ggml 的 CPU 后端编成了几种（CMakeLists.txt）：按从新到旧的顺序试，
// ggml_backend_load 会先问这台手机支不支持（ggml_backend_score），不支持就跳过。
// 不用带 SVE / SME 的几种（armv9.x，build.gradle 也不打包）：Android 模拟器在苹果芯片上声称支持 SVE2 / SME2，
// 实际一用就卡死；Mac 上同样的代码直接报非法指令。手机上 128 位的 SVE 也不比 NEON 快。
void load_backends() {
#ifdef MORPH_GGML_DL
  std::call_once(backends_once, [] {
    const char *variants[] = {
        "libggml-cpu-android_armv8.6_1.so",
        "libggml-cpu-android_armv8.2_2.so",
        "libggml-cpu-android_armv8.2_1.so",
        "libggml-cpu-android_armv8.0_1.so",
    };
    for (const char *name : variants) {
      if (ggml_backend_load(name) != nullptr) {
        backend_name = name;
        return;
      }
    }
    backend_name = "none";
  });
#endif
}

void quiet_log(enum ggml_log_level, const char *, void *) {}

bool abort_cb(void *user_data) {
  return static_cast<Session *>(user_data)->cancel.load();
}

void progress_cb(whisper_context *, whisper_state *, int progress, void *user_data) {
  static_cast<Session *>(user_data)->progress.store(progress);
}

Session *session(jlong handle) { return reinterpret_cast<Session *>(handle); }

}  // namespace

extern "C" {

JNIEXPORT jstring JNICALL
Java_expo_modules_morphspeech_WhisperNative_backend(JNIEnv *env, jobject) {
  load_backends();
  return env->NewStringUTF(backend_name.c_str());
}

// whisper 能识别的语言代码（zh、en…）。
JNIEXPORT jobjectArray JNICALL
Java_expo_modules_morphspeech_WhisperNative_languages(JNIEnv *env, jobject) {
  const int n = whisper_lang_max_id() + 1;
  jobjectArray out = env->NewObjectArray(n, env->FindClass("java/lang/String"), nullptr);
  for (int i = 0; i < n; i++) {
    env->SetObjectArrayElement(out, i, env->NewStringUTF(whisper_lang_str(i)));
  }
  return out;
}

// 加载模型；vadPath 是语音检测模型（跳过没人说话的部分，避免 whisper 在静音里「编」出句子）。失败返回 0。
JNIEXPORT jlong JNICALL Java_expo_modules_morphspeech_WhisperNative_init(
    JNIEnv *env, jobject, jstring model_path, jstring vad_path) {
  load_backends();
  whisper_log_set(quiet_log, nullptr);
  const char *model = env->GetStringUTFChars(model_path, nullptr);
  whisper_context_params cparams = whisper_context_default_params();
  cparams.use_gpu = false;
  whisper_context *ctx = whisper_init_from_file_with_params(model, cparams);
  env->ReleaseStringUTFChars(model_path, model);
  if (ctx == nullptr) return 0;
  auto *s = new Session();
  s->ctx = ctx;
  if (vad_path != nullptr) {
    const char *vad = env->GetStringUTFChars(vad_path, nullptr);
    s->vad_path = vad;
    env->ReleaseStringUTFChars(vad_path, vad);
  }
  return reinterpret_cast<jlong>(s);
}

JNIEXPORT void JNICALL Java_expo_modules_morphspeech_WhisperNative_free(JNIEnv *, jobject, jlong handle) {
  Session *s = session(handle);
  if (s == nullptr) return;
  whisper_free(s->ctx);
  delete s;
}

JNIEXPORT void JNICALL Java_expo_modules_morphspeech_WhisperNative_cancel(JNIEnv *, jobject, jlong handle) {
  session(handle)->cancel.store(true);
}

JNIEXPORT jint JNICALL Java_expo_modules_morphspeech_WhisperNative_progress(JNIEnv *, jobject, jlong handle) {
  return session(handle)->progress.load();
}

// 识别一段 16 kHz 单声道的声音。返回段数；取消返回 -1，失败返回 -2。
JNIEXPORT jint JNICALL Java_expo_modules_morphspeech_WhisperNative_transcribe(
    JNIEnv *env, jobject, jlong handle, jfloatArray samples, jint count, jstring language,
    jstring prompt, jint threads) {
  Session *s = session(handle);
  s->progress.store(0);
  if (s->cancel.load()) return -1;

  whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_BEAM_SEARCH);
  params.n_threads = threads;
  params.print_progress = false;
  params.print_realtime = false;
  params.print_special = false;
  params.print_timestamps = false;
  params.translate = false;
  params.no_timestamps = false;
  params.beam_search.beam_size = 5;
  params.abort_callback = abort_cb;
  params.abort_callback_user_data = s;
  params.progress_callback = progress_cb;
  params.progress_callback_user_data = s;
  if (!s->vad_path.empty()) {
    params.vad = true;
    params.vad_model_path = s->vad_path.c_str();
  }

  const char *lang = env->GetStringUTFChars(language, nullptr);
  std::string lang_copy = lang;
  env->ReleaseStringUTFChars(language, lang);
  params.language = lang_copy.c_str();

  std::string prompt_copy;
  if (prompt != nullptr) {
    const char *p = env->GetStringUTFChars(prompt, nullptr);
    prompt_copy = p;
    env->ReleaseStringUTFChars(prompt, p);
    params.initial_prompt = prompt_copy.c_str();
  }

  jfloat *data = env->GetFloatArrayElements(samples, nullptr);
  int result = whisper_full(s->ctx, params, data, count);
  env->ReleaseFloatArrayElements(samples, data, JNI_ABORT);

  if (s->cancel.load()) return -1;
  if (result != 0) return -2;
  return whisper_full_n_segments(s->ctx);
}

// 段的文字（UTF-8 字节，由 Kotlin 解码：NewStringUTF 要的是改过的 UTF-8，表情符号会出错）。
JNIEXPORT jbyteArray JNICALL Java_expo_modules_morphspeech_WhisperNative_segmentText(
    JNIEnv *env, jobject, jlong handle, jint i) {
  const char *text = whisper_full_get_segment_text(session(handle)->ctx, i);
  const jsize len = static_cast<jsize>(strlen(text));
  jbyteArray out = env->NewByteArray(len);
  env->SetByteArrayRegion(out, 0, len, reinterpret_cast<const jbyte *>(text));
  return out;
}

// 段的开始 / 结束时间（毫秒，相对这一段声音的开头）。
JNIEXPORT jlong JNICALL Java_expo_modules_morphspeech_WhisperNative_segmentStart(
    JNIEnv *, jobject, jlong handle, jint i) {
  return whisper_full_get_segment_t0(session(handle)->ctx, i) * 10;
}

JNIEXPORT jlong JNICALL Java_expo_modules_morphspeech_WhisperNative_segmentEnd(
    JNIEnv *, jobject, jlong handle, jint i) {
  return whisper_full_get_segment_t1(session(handle)->ctx, i) * 10;
}

}  // extern "C"
