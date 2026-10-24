package expo.modules.morphmedia

import java.io.File
import java.io.FileOutputStream

// MP3 输出（D-183）：Media3 和系统都没有 MP3 编码器，用编进 App 的 LAME（libmorphmp3.so，见 src/main/cpp）。
// AudioPcm.decode 解出来的 16 位 PCM 一块一块交进来，边编码边写文件，不把整段放进内存。

class Mp3Writer(private val file: File, private val kbps: Int) {
  private val out = FileOutputStream(file)
  private var handle = 0L
  private var channels = 0
  private var buffer = ByteArray(0)

  /** 第一块决定声道和采样率（LAME 需要时自己重采样成 MP3 支持的采样率）。 */
  fun write(samples: ShortArray, channels: Int, rate: Int) {
    if (handle == 0L) {
      handle = Mp3Encoder.nativeInit(rate, channels, kbps)
      if (handle == 0L) {
        out.close()
        throw MediaFailedException("mp3 encoder $rate Hz $channels ch $kbps kbps")
      }
      this.channels = channels
    }
    val frames = samples.size / this.channels
    // LAME 要求的最坏情况：1.25 × 样本数 + 7200 字节。
    val needed = frames * 5 / 4 + 7200
    if (buffer.size < needed) buffer = ByteArray(needed)
    val written = Mp3Encoder.nativeEncode(handle, samples, frames, buffer)
    if (written < 0) throw MediaFailedException("mp3 encode $written")
    out.write(buffer, 0, written)
  }

  fun close() {
    if (handle == 0L) {
      out.close()
      throw MediaUnsupportedException("no audio decoded")
    }
    if (buffer.size < 7200) buffer = ByteArray(7200)
    val written = Mp3Encoder.nativeFlush(handle, buffer)
    if (written > 0) out.write(buffer, 0, written)
    Mp3Encoder.nativeClose(handle)
    handle = 0L
    out.close()
  }

  /** 取消或出错时：放掉编码器，关上文件（文件由调用方删除）。 */
  fun abort() {
    if (handle != 0L) Mp3Encoder.nativeClose(handle)
    handle = 0L
    out.close()
  }
}

object Mp3Encoder {
  init {
    System.loadLibrary("morphmp3")
  }

  @JvmStatic external fun nativeInit(sampleRate: Int, channels: Int, kbps: Int): Long

  @JvmStatic external fun nativeEncode(handle: Long, pcm: ShortArray, frames: Int, out: ByteArray): Int

  @JvmStatic external fun nativeFlush(handle: Long, out: ByteArray): Int

  @JvmStatic external fun nativeClose(handle: Long)
}
