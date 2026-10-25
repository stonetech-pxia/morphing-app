package expo.modules.morphmedia

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SonicAudioProcessor
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** 流式重采样到 48kHz，逐声道降噪，补偿 RNNoise 的 20ms 延迟。 */
object AudioDenoise {
  fun prepare(context: Context, uri: Uri, output: File, cancelled: AtomicBoolean, durationMs: Double, progress: (Double) -> Unit) {
    var handle = 0L
    var rate = 0; var channels = 0
    var processor: SonicAudioProcessor? = null
    var input = FloatArray(0); var filtered = FloatArray(0)
    var filled = 0; var skip = 960; var written = 0L
    val total = (durationMs * 48).roundToLong()
    val writer = AudioPcm.WavWriter(output)
    var complete = false
    fun process() {
      if (cancelled.get()) throw MediaCancelledException()
      if (AudioDsp.nativeDenoise(handle, input, filtered) != 0) throw MediaFailedException("denoise frame")
      val drop = minOf(480, skip); skip -= drop
      val count = minOf((480 - drop).toLong(), total - written).toInt()
      if (count > 0) {
        val samples = ShortArray(count * channels) { i -> (filtered[drop * channels + i] * 32768).roundToInt().coerceIn(-32768,32767).toShort() }
        writer.write(samples, channels, 48000); written += count
      }
      filled = 0
    }
    fun consume(buffer: ByteBuffer) {
      buffer.order(ByteOrder.nativeOrder())
      while (buffer.remaining() >= channels * 2) {
        for (c in 0 until channels) input[filled * channels + c] = buffer.short / 32768f
        filled++
        if (filled == 480) process()
      }
    }
    fun drain() { processor?.let { consume(it.output) } }
    try {
      AudioPcm.visitTimeline(context, uri, durationMs, { cancelled.get() }) { chunk ->
        if (handle == 0L) {
          rate = chunk.sampleRate; channels = chunk.channels
          if (channels !in 1..2) throw MediaUnsupportedException("denoise supports mono or stereo")
          handle = AudioDsp.nativeDenoiseCreate(channels)
          if (handle == 0L) throw MediaFailedException("denoiser")
          input = FloatArray(480 * channels); filtered = input.copyOf()
          if (rate != 48000) processor = SonicAudioProcessor().apply {
            setOutputSampleRateHz(48000)
            configure(AudioProcessor.AudioFormat(rate, channels, C.ENCODING_PCM_16BIT)); flush()
          }
        }
        val buffer = ByteBuffer.allocateDirect(chunk.count * 2).order(ByteOrder.nativeOrder())
        buffer.asShortBuffer().put(chunk.samples, 0, chunk.count)
        if (processor != null) { processor!!.queueInput(buffer); drain() } else consume(buffer)
      }
      if (handle == 0L) throw MediaUnsupportedException("no audio decoded")
      processor?.queueEndOfStream(); drain()
      if (filled > 0) { input.fill(0f, filled * channels); process() }
      input.fill(0f)
      // 补齐尾端模型延迟，以及重采样最多一个采样点的取整误差。
      while (written < total) process()
      complete = true
      progress(0.5)
    } finally {
      if (complete) writer.close() else runCatching { writer.close() }
      processor?.reset()
      if (handle != 0L) AudioDsp.nativeDenoiseDestroy(handle)
    }
  }
}
