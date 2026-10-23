package expo.modules.morphspeech

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteOrder

// 用系统的 MediaExtractor + MediaCodec 把音频文件（m4a、mp3、wav、amr、ogg、flac…，视频文件里的声音也行）
// 解码成 16 kHz 单声道 float，一块一块地交给 sink，不把整个文件放进内存。

class UnreadableAudio(message: String) : Exception(message)

class AudioDecoder(private val context: Context, private val uri: Uri) {
  /** 时长（微秒）；文件里没写时为 0。 */
  var durationUs = 0L
    private set

  fun decode(isCancelled: () -> Boolean, sink: (FloatArray, Int) -> Unit) {
    val extractor = MediaExtractor()
    try {
      try {
        extractor.setDataSource(context, uri, null)
      } catch (e: Exception) {
        throw UnreadableAudio(e.message ?: "open")
      }
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw UnreadableAudio("no audio track")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      if (format.containsKey(MediaFormat.KEY_DURATION)) durationUs = format.getLong(MediaFormat.KEY_DURATION)
      val codec = try {
        MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!).apply {
          configure(format, null, null, 0)
          start()
        }
      } catch (e: Exception) {
        throw UnreadableAudio(e.message ?: "codec")
      }
      try {
        pump(extractor, codec, format, isCancelled, sink)
      } finally {
        codec.stop()
        codec.release()
      }
    } finally {
      extractor.release()
    }
  }

  private fun pump(
    extractor: MediaExtractor,
    codec: MediaCodec,
    inputFormat: MediaFormat,
    isCancelled: () -> Boolean,
    sink: (FloatArray, Int) -> Unit,
  ) {
    var channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    var rate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var encoding = AudioFormat.ENCODING_PCM_16BIT
    var resampler: Resampler? = null
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var scratch = FloatArray(0)

    while (true) {
      if (isCancelled()) return
      if (!inputDone) {
        val index = codec.dequeueInputBuffer(TIMEOUT_US)
        if (index >= 0) {
          val buffer = codec.getInputBuffer(index)!!
          val size = extractor.readSampleData(buffer, 0)
          if (size < 0) {
            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            codec.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
            extractor.advance()
          }
        }
      }
      val index = codec.dequeueOutputBuffer(info, TIMEOUT_US)
      when {
        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          val out = codec.outputFormat
          channels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          rate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          if (out.containsKey(MediaFormat.KEY_PCM_ENCODING)) encoding = out.getInteger(MediaFormat.KEY_PCM_ENCODING)
          resampler = null
        }
        index >= 0 -> {
          val buffer = codec.getOutputBuffer(index)!!.order(ByteOrder.nativeOrder())
          buffer.position(info.offset)
          buffer.limit(info.offset + info.size)
          val values: Int
          if (encoding == AudioFormat.ENCODING_PCM_FLOAT) {
            values = info.size / 4
            if (scratch.size < values) scratch = FloatArray(values)
            buffer.asFloatBuffer().get(scratch, 0, values)
          } else {
            values = info.size / 2
            if (scratch.size < values) scratch = FloatArray(values)
            val shorts = buffer.asShortBuffer()
            for (i in 0 until values) scratch[i] = shorts.get(i) / 32768f
          }
          codec.releaseOutputBuffer(index, false)
          val frames = values / channels
          if (frames > 0) {
            val mono = downmix(scratch, frames, channels)
            val r = resampler ?: Resampler(rate).also { resampler = it }
            r.push(mono, frames, sink)
          }
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
            resampler?.finish(sink)
            return
          }
        }
      }
    }
  }

  private companion object {
    const val TIMEOUT_US = 10_000L
  }
}
