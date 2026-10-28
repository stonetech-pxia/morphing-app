package expo.modules.morphtts

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.Locale
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.concurrent.thread

// 文字转语音的 Android 实现（D-270）：系统的 TextToSpeech（多数手机是 Google「语音服务」），和 iOS 的 JS 接口相同。
// 每段用 synthesizeToFile 写一个 WAV（中间文件放在输出文件旁边），全部读完后接成一个（Wav.join），
// 中间文件成功、失败、取消都删掉。声音数据缺了不偷偷下载，报 ERR_TTS_NOT_DOWNLOADED，由用户在系统设置里下载。
// 文字只交给系统朗读引擎，不写日志。

class TTSException(code: String, message: String) : CodedException(code, message, null)

private fun noVoice(voice: String) = TTSException("ERR_TTS_NO_VOICE", "No voice for $voice")
private fun notDownloaded(voice: String) =
  TTSException("ERR_TTS_NOT_DOWNLOADED", "The voice data for $voice is not installed")
private fun unavailable() = TTSException("ERR_TTS_UNAVAILABLE", "No text-to-speech engine")
private fun cancelled() = TTSException("ERR_TTS_CANCELLED", "Cancelled")
private fun failed(detail: String) = TTSException("ERR_TTS_FAILED", detail)

class SynthesizeOptions : Record {
  @Field val taskId: String = ""
  @Field val voice: String = ""
  @Field val rate: Double = 1.0
  @Field val output: String = ""
}

/** 朗读引擎连上的最长等待：没有引擎、引擎被停用时初始化回调可能一直不来。 */
private const val INIT_TIMEOUT_SECONDS = 15L

/** 一段最多等多久：引擎通常比实时快很多倍；卡住时（引擎崩了）不能让 Promise 一直不结束。 */
private fun segmentTimeoutSeconds(text: String) = 60L + text.length / 2

/** 一次朗读：取消时停掉引擎，把正在等的那一段结束掉。 */
private class TTSJob {
  @Volatile var cancelled = false
  @Volatile var engine: TextToSpeech? = null
  val waiting = ConcurrentHashMap<String, CompletableFuture<Unit>>()

  fun cancel() {
    cancelled = true
    engine?.stop()
    waiting.values.forEach { it.completeExceptionally(InterruptedException("cancelled")) }
  }
}

class MorphTTSModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  private val jobs = ConcurrentHashMap<String, TTSJob>()

  override fun definition() = ModuleDefinition {
    Name("MorphTTS")

    Events("onProgress")

    AsyncFunction("voiceStatus") { voice: String, promise: Promise ->
      thread(name = "morph-tts-status") {
        val engine = try {
          openEngine()
        } catch (e: Throwable) {
          // 没有引擎、引擎被停用，或绑定时系统抛错：都当作没有朗读引擎，Promise 一定要结束。
          promise.resolve("noEngine")
          return@thread
        }
        try {
          promise.resolve(
            when (engine.isLanguageAvailable(Locale.forLanguageTag(voice))) {
              TextToSpeech.LANG_MISSING_DATA -> "notDownloaded"
              TextToSpeech.LANG_NOT_SUPPORTED -> "unsupported"
              TextToSpeech.LANG_AVAILABLE,
              TextToSpeech.LANG_COUNTRY_AVAILABLE,
              TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE -> "installed"
              else -> "unsupported"
            }
          )
        } catch (e: Throwable) {
          promise.reject(failed(e.message ?: e.toString()))
        } finally {
          engine.shutdown()
        }
      }
    }

    AsyncFunction("synthesize") { segments: List<String>, options: SynthesizeOptions, promise: Promise ->
      // 先登记再开线程：JS 的取消轮询可能比线程先到。
      val job = TTSJob()
      jobs[options.taskId] = job
      thread(name = "morph-tts") {
        val output = fileOf(options.output)
        try {
          promise.resolve(synthesize(segments, options, output, job))
        } catch (e: Throwable) {
          output.delete()
          promise.reject(
            when {
              job.cancelled -> cancelled()
              e is CodedException -> e
              else -> failed(e.message ?: e.toString())
            }
          )
        } finally {
          jobs.remove(options.taskId)
        }
      }
    }

    Function("cancel") { taskId: String ->
      jobs[taskId]?.cancel()
    }
  }

  private fun fileOf(uri: String): File =
    if (uri.startsWith("file://")) File(Uri.parse(uri).path!!) else File(uri)

  /** 连上系统的朗读引擎（在后台线程等初始化回调）；连不上时抛 ERR_TTS_UNAVAILABLE。 */
  private fun openEngine(): TextToSpeech {
    val ready = CompletableFuture<Int>()
    val engine = TextToSpeech(context) { status -> ready.complete(status) }
    val status = try {
      ready.get(INIT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    } catch (e: TimeoutException) {
      TextToSpeech.ERROR
    }
    if (status != TextToSpeech.SUCCESS) {
      engine.shutdown()
      throw unavailable()
    }
    return engine
  }

  private fun synthesize(
    segments: List<String>,
    options: SynthesizeOptions,
    output: File,
    job: TTSJob,
  ): Map<String, Any> {
    if (segments.isEmpty()) throw failed("nothing to read")
    val dir = output.parentFile ?: throw failed("no output folder")
    dir.mkdirs()
    val parts = mutableListOf<File>()
    val engine = openEngine()
    job.engine = engine
    try {
      if (job.cancelled) throw cancelled()
      when (engine.setLanguage(Locale.forLanguageTag(options.voice))) {
        TextToSpeech.LANG_MISSING_DATA -> throw notDownloaded(options.voice)
        TextToSpeech.LANG_NOT_SUPPORTED -> throw noVoice(options.voice)
      }
      engine.setSpeechRate(options.rate.toFloat().coerceIn(0.5f, 2f))
      engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String) {}

        override fun onDone(utteranceId: String) {
          job.waiting.remove(utteranceId)?.complete(Unit)
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String) {
          job.waiting.remove(utteranceId)?.completeExceptionally(failed("engine error"))
        }

        override fun onError(utteranceId: String, errorCode: Int) {
          job.waiting.remove(utteranceId)?.completeExceptionally(failed("engine error $errorCode"))
        }

        override fun onStop(utteranceId: String, interrupted: Boolean) {
          job.waiting.remove(utteranceId)?.completeExceptionally(InterruptedException("stopped"))
        }
      })

      segments.forEachIndexed { i, text ->
        if (job.cancelled) throw cancelled()
        val part = File(dir, ".tts-${options.taskId}-$i.wav")
        parts += part
        val id = "${options.taskId}-$i"
        val done = CompletableFuture<Unit>()
        job.waiting[id] = done
        if (engine.synthesizeToFile(text, Bundle(), part, id) != TextToSpeech.SUCCESS) {
          job.waiting.remove(id)
          throw failed("synthesizeToFile refused segment $i")
        }
        try {
          done.get(segmentTimeoutSeconds(text), TimeUnit.SECONDS)
        } catch (e: ExecutionException) {
          throw e.cause ?: e
        } catch (e: TimeoutException) {
          job.waiting.remove(id)
          throw failed("segment $i timed out")
        }
        if (job.cancelled) throw cancelled()
        sendEvent(
          "onProgress",
          mapOf("taskId" to options.taskId, "fraction" to (i + 1).toDouble() / segments.size),
        )
      }

      // 只有符号、读不出声音的段，引擎可能不写文件：跳过它。
      val written = parts.filter { it.exists() && it.length() > 0 }
      if (written.isEmpty()) throw failed("the engine wrote no audio")
      val info = Wav.join(written, output) { job.cancelled }
      return mapOf(
        "uri" to Uri.fromFile(output).toString(),
        "size" to output.length().toDouble(),
        "durationMs" to info.durationMs,
        "sampleRate" to info.sampleRate,
        "channels" to info.channels,
      )
    } finally {
      job.engine = null
      parts.forEach { it.delete() }
      engine.stop()
      engine.shutdown()
    }
  }
}
