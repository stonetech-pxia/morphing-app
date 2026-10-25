package expo.modules.morphmedia

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// 音频（D-153、D-155，音频会话）：Media3 Transformer 只能写 MP4 一类的容器，WAV 和波形要自己解码。
// 用系统的 MediaExtractor + MediaCodec 解成 16 位 PCM，一块一块地交出去，不把整个文件放进内存。

/** 解码出来的一块：交错的 16 位样本。 */
class PcmChunk(val samples: ShortArray, val count: Int, val channels: Int, val sampleRate: Int, val ptsUs: Long)

object AudioPcm {
  private const val TIMEOUT_US = 10_000L

  /**
   * 解码 [startUs, endUs) 这一段的声音（视频文件取它的音轨）。返回声音的总时长（微秒，读不到为 0）。
   * isCancelled 为真时提前结束。
   */
  fun decode(
    context: Context,
    uri: Uri,
    startUs: Long,
    endUs: Long,
    isCancelled: () -> Boolean,
    sink: (PcmChunk) -> Unit,
  ): Long {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(context, uri, null)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw MediaUnsupportedException("no audio")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      if (startUs > 0) extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val codec = try {
        MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!).apply {
          configure(format, null, null, 0)
          start()
        }
      } catch (e: Exception) {
        throw MediaUnsupportedException(e.message)
      }
      try {
        pump(extractor, codec, format, startUs, endUs, isCancelled, sink)
      } finally {
        codec.stop()
        codec.release()
      }
      return durationUs
    } finally {
      extractor.release()
    }
  }

  private fun pump(
    extractor: MediaExtractor,
    codec: MediaCodec,
    inputFormat: MediaFormat,
    startUs: Long,
    endUs: Long,
    isCancelled: () -> Boolean,
    sink: (PcmChunk) -> Unit,
  ) {
    var channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    var rate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var encoding = AudioFormat.ENCODING_PCM_16BIT
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    while (!isCancelled()) {
      if (!inputDone) {
        val index = codec.dequeueInputBuffer(TIMEOUT_US)
        if (index >= 0) {
          val buffer = codec.getInputBuffer(index)!!
          val size = extractor.readSampleData(buffer, 0)
          if (size < 0 || extractor.sampleTime > endUs) {
            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            codec.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
            extractor.advance()
          }
        }
      }
      val index = codec.dequeueOutputBuffer(info, TIMEOUT_US)
      if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        val out = codec.outputFormat
        channels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        rate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        if (out.containsKey(MediaFormat.KEY_PCM_ENCODING)) encoding = out.getInteger(MediaFormat.KEY_PCM_ENCODING)
      } else if (index >= 0) {
        val buffer = codec.getOutputBuffer(index)!!.order(ByteOrder.nativeOrder())
        buffer.position(info.offset)
        buffer.limit(info.offset + info.size)
        val samples = toShorts(buffer, encoding)
        codec.releaseOutputBuffer(index, false)
        if (samples.isNotEmpty()) {
          // 开头：seek 落在前一个关键帧，丢掉 startUs 之前的样本；结尾同理。
          val frames = samples.size / channels
          val frameUs = 1_000_000.0 / rate
          val first = if (info.presentationTimeUs < startUs) {
            min(frames, ((startUs - info.presentationTimeUs) / frameUs).toInt())
          } else 0
          val last = if (info.presentationTimeUs + frames * frameUs > endUs) {
            max(0, ((endUs - info.presentationTimeUs) / frameUs).toInt())
          } else frames
          if (last > first) {
            val part = samples.copyOfRange(first * channels, last * channels)
            sink(PcmChunk(part, part.size, channels, rate, info.presentationTimeUs + (first * frameUs).toLong()))
          }
        }
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
      }
    }
  }

  private fun toShorts(buffer: ByteBuffer, encoding: Int): ShortArray {
    if (encoding == AudioFormat.ENCODING_PCM_FLOAT) {
      val floats = buffer.asFloatBuffer()
      return ShortArray(floats.remaining()) { (floats.get(it).coerceIn(-1f, 1f) * 32767).toInt().toShort() }
    }
    val shorts = buffer.asShortBuffer()
    return ShortArray(shorts.remaining()) { shorts.get(it) }
  }

  /** 交错的多声道 → channels 个声道：单声道取平均，双声道取前两个。 */
  fun remix(chunk: PcmChunk, channels: Int): ShortArray {
    if (chunk.channels == channels) return chunk.samples
    val frames = chunk.count / chunk.channels
    return ShortArray(frames * channels) { i ->
      val f = i / channels
      if (channels == 1) {
        var sum = 0
        for (c in 0 until chunk.channels) sum += chunk.samples[f * chunk.channels + c]
        (sum / chunk.channels).toShort()
      } else {
        chunk.samples[f * chunk.channels + min(i % channels, chunk.channels - 1)]
      }
    }
  }

  /** 写 WAV（16 位 PCM）：先写一个空的文件头，写完再填上大小。 */
  class WavWriter(private val file: File) {
    private val out = RandomAccessFile(file, "rw")
    private var bytes = 0L
    private var channels = 0
    private var rate = 0

    fun write(samples: ShortArray, channels: Int, rate: Int) {
      if (this.channels == 0) {
        this.channels = channels
        this.rate = rate
        out.setLength(0)
        out.write(ByteArray(44))
      }
      if (bytes + samples.size * 2L > 0xffffffffL - 36) throw MediaUnsupportedException("audio is too long for a WAV intermediate")
      val buf = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
      buf.asShortBuffer().put(samples)
      out.write(buf.array())
      bytes += samples.size * 2L
    }

    fun close() {
      if (channels == 0) {
        out.close()
        throw MediaUnsupportedException("no audio decoded")
      }
      val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
      header.put("RIFF".toByteArray()).putInt((36 + bytes).toInt()).put("WAVE".toByteArray())
      header.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(channels.toShort())
      header.putInt(rate).putInt(rate * channels * 2).putShort((channels * 2).toShort()).putShort(16)
      header.put("data".toByteArray()).putInt(bytes.toInt())
      out.seek(0)
      out.write(header.array())
      out.close()
    }
  }

  /** 波形：每一份时间里最大的音量，按最响的一份归一到 0–1。 */
  fun waveform(context: Context, uri: Uri, buckets: Int, startUs: Long, endUs: Long): List<Double> {
    val peaks = DoubleArray(buckets)
    var spanUs = endUs - startUs
    val chunks = mutableListOf<Pair<Long, Double>>()
    val total = decode(context, uri, startUs, endUs, { false }) { chunk ->
      var peak = 0
      for (i in 0 until chunk.count) peak = max(peak, abs(chunk.samples[i].toInt()))
      chunks += chunk.ptsUs to peak / 32768.0
    }
    if (spanUs == Long.MAX_VALUE - startUs || spanUs <= 0) spanUs = max(1L, total - startUs)
    for ((pts, peak) in chunks) {
      val bucket = (((pts - startUs).toDouble() / spanUs) * buckets).toInt().coerceIn(0, buckets - 1)
      peaks[bucket] = max(peaks[bucket], peak)
    }
    // 解码出来的块比份数少时（很短的录音），空着的份用前一份补上。
    if (chunks.size < buckets) for (i in 1 until buckets) if (peaks[i] == 0.0) peaks[i] = peaks[i - 1]
    val loudest = peaks.maxOrNull() ?: 0.0
    return if (loudest > 0) peaks.map { it / loudest } else peaks.toList()
  }
}
