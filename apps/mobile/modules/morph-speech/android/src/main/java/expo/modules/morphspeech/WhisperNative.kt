package expo.modules.morphspeech

// whisper.cpp 的 JNI 接口（src/main/cpp/morph_whisper.cpp）。handle 是原生的会话指针，用完必须 free。

object WhisperNative {
  init {
    System.loadLibrary("morphwhisper")
  }

  /** 这台手机用的 CPU 后端（例如 libggml-cpu-android_armv8.2_2.so），实测记录用。 */
  external fun backend(): String

  external fun languages(): Array<String>

  /** 加载模型；失败返回 0。 */
  external fun init(modelPath: String, vadPath: String?): Long

  external fun free(handle: Long)

  /** 让正在进行的 transcribe 尽快返回 -1。 */
  external fun cancel(handle: Long)

  /** 当前这一段的进度，0–100。 */
  external fun progress(handle: Long): Int

  /** 识别一段 16 kHz 单声道的声音。返回段数；取消返回 -1，失败返回 -2。 */
  external fun transcribe(
    handle: Long,
    samples: FloatArray,
    count: Int,
    language: String,
    prompt: String?,
    threads: Int,
  ): Int

  external fun segmentText(handle: Long, index: Int): ByteArray

  external fun segmentStart(handle: Long, index: Int): Long

  external fun segmentEnd(handle: Long, index: Int): Long
}
