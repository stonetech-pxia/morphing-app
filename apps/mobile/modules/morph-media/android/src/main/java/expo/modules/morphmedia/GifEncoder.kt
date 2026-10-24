package expo.modules.morphmedia

import java.io.OutputStream

// 动图 GIF 的编码器（D-184）：Android 系统没有 GIF 编码器，自己写一个，不引入第三方库。
// 每一帧自己的 256 色调色板（中位切分），4×4 有序抖动减少色带，LZW 压缩，循环播放。
// 只用 ARGB 像素数组，不碰 Android 的类，可以在电脑上的 JVM 里测试（GifEncoderTest）。

class GifEncoder(
  private val out: OutputStream,
  private val width: Int,
  private val height: Int,
) {
  private var started = false
  private val lzw = Lzw()

  /** 加一帧：pixels 是 width × height 个 ARGB（透明度忽略），delayMs 是这一帧停留的时间。 */
  fun addFrame(pixels: IntArray, delayMs: Int) {
    require(pixels.size == width * height) { "frame size" }
    if (!started) writeHeader()
    val palette = Palette.of(pixels)
    val indices = palette.map(pixels, width)
    // 图形控制扩展：停留时间（百分之一秒），不透明。
    val delay = ((delayMs + 5) / 10).coerceIn(2, 65535)
    out.write(byteArrayOf(0x21, 0xF9.toByte(), 4, 0x04, (delay and 0xFF).toByte(), (delay shr 8).toByte(), 0, 0))
    // 图像描述：整张画布，带 256 色的局部调色板。
    out.write(0x2C)
    writeShort(0)
    writeShort(0)
    writeShort(width)
    writeShort(height)
    out.write(0x87)
    out.write(palette.rgb)
    lzw.encode(indices, out)
  }

  fun finish() {
    out.write(0x3B)
    out.flush()
  }

  private fun writeHeader() {
    started = true
    out.write("GIF89a".toByteArray(Charsets.US_ASCII))
    writeShort(width)
    writeShort(height)
    out.write(byteArrayOf(0x70, 0, 0)) // 没有全局调色板
    // NETSCAPE2.0：无限循环。
    out.write(byteArrayOf(0x21, 0xFF.toByte(), 0x0B))
    out.write("NETSCAPE2.0".toByteArray(Charsets.US_ASCII))
    out.write(byteArrayOf(3, 1, 0, 0, 0))
  }

  private fun writeShort(value: Int) {
    out.write(value and 0xFF)
    out.write((value shr 8) and 0xFF)
  }
}

/** 一帧的调色板：中位切分，按每个通道 5 位（32768 种颜色）的直方图来分。 */
internal class Palette private constructor(
  /** 256 × 3 字节（不足 256 色时后面补 0）。 */
  val rgb: ByteArray,
  /** 5 位 RGB → 调色板序号。 */
  private val lookup: ByteArray,
) {
  /** 每个像素 → 调色板序号，加 4×4 有序抖动（按 5 位网格的一格大小）。 */
  fun map(pixels: IntArray, width: Int): ByteArray {
    val indices = ByteArray(pixels.size)
    for (i in pixels.indices) {
      val p = pixels[i]
      val d = BAYER[((i / width) and 3) * 4 + ((i % width) and 3)]
      val r = (((p shr 16) and 0xFF) + d).coerceIn(0, 255) shr 3
      val g = (((p shr 8) and 0xFF) + d).coerceIn(0, 255) shr 3
      val b = ((p and 0xFF) + d).coerceIn(0, 255) shr 3
      indices[i] = lookup[(r shl 10) or (g shl 5) or b]
    }
    return indices
  }

  companion object {
    /** 4×4 Bayer 矩阵，换算成 -4..+3（5 位网格的一格是 8）。 */
    private val BAYER = intArrayOf(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5).map { it / 2 - 4 }.toIntArray()

    fun of(pixels: IntArray): Palette {
      val counts = IntArray(32768)
      for (p in pixels) counts[(((p shr 19) and 31) shl 10) or (((p shr 11) and 31) shl 5) or ((p shr 3) and 31)]++
      val colors = counts.indices.filter { counts[it] > 0 }.toIntArray()
      val boxes = ArrayList<IntArray>()
      boxes.add(colors)
      // 每次把「颜色最多的那一维跨度 × 像素数」最大的盒子沿那一维从中位数切开，直到 256 个。
      while (boxes.size < 256) {
        var best = -1
        var bestScore = 0L
        var bestAxis = 0
        for ((i, box) in boxes.withIndex()) {
          if (box.size < 2) continue
          val (axis, span) = widestAxis(box)
          if (span == 0) continue
          var pixelsIn = 0L
          for (c in box) pixelsIn += counts[c]
          val score = span.toLong() * pixelsIn
          if (score > bestScore) {
            bestScore = score
            best = i
            bestAxis = axis
          }
        }
        if (best < 0) break
        val box = boxes[best].sortedBy { channel(it, bestAxis) }.toIntArray()
        var total = 0L
        for (c in box) total += counts[c]
        var acc = 0L
        var cut = 1
        for (k in box.indices) {
          acc += counts[box[k]]
          if (acc * 2 >= total) {
            cut = (k + 1).coerceIn(1, box.size - 1)
            break
          }
        }
        boxes[best] = box.copyOfRange(0, cut)
        boxes.add(box.copyOfRange(cut, box.size))
      }
      val rgb = ByteArray(256 * 3)
      val lookup = ByteArray(32768)
      for ((i, box) in boxes.withIndex()) {
        // 盒子的颜色 = 按像素数加权的平均（换回 8 位）。
        var r = 0L
        var g = 0L
        var b = 0L
        var n = 0L
        for (c in box) {
          val w = counts[c].toLong()
          r += channel(c, 0) * w
          g += channel(c, 1) * w
          b += channel(c, 2) * w
          n += w
        }
        rgb[i * 3] = ((r * 8 + n * 4) / n).coerceAtMost(255).toByte()
        rgb[i * 3 + 1] = ((g * 8 + n * 4) / n).coerceAtMost(255).toByte()
        rgb[i * 3 + 2] = ((b * 8 + n * 4) / n).coerceAtMost(255).toByte()
        for (c in box) lookup[c] = i.toByte()
      }
      // 抖动会落到这一帧没出现过的颜色上：这些颜色找最近的调色板颜色。
      val used = boxes.size
      for (c in 0 until 32768) {
        if (counts[c] > 0) continue
        val r = channel(c, 0) * 8 + 4
        val g = channel(c, 1) * 8 + 4
        val b = channel(c, 2) * 8 + 4
        var best = 0
        var bestDist = Int.MAX_VALUE
        for (i in 0 until used) {
          val dr = r - (rgb[i * 3].toInt() and 0xFF)
          val dg = g - (rgb[i * 3 + 1].toInt() and 0xFF)
          val db = b - (rgb[i * 3 + 2].toInt() and 0xFF)
          val dist = dr * dr * 2 + dg * dg * 4 + db * db
          if (dist < bestDist) {
            bestDist = dist
            best = i
          }
        }
        lookup[c] = best.toByte()
      }
      return Palette(rgb, lookup)
    }

    private fun channel(color: Int, axis: Int) = (color shr (10 - axis * 5)) and 31

    private fun widestAxis(box: IntArray): Pair<Int, Int> {
      var axis = 0
      var span = -1
      for (a in 0..2) {
        var lo = 31
        var hi = 0
        for (c in box) {
          val v = channel(c, a)
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
        if (hi - lo > span) {
          span = hi - lo
          axis = a
        }
      }
      return axis to span
    }
  }
}

/**
 * GIF 的 LZW：8 位最小码长，码表满 4096 时发清除码重来；输出分成不超过 255 字节的数据块。
 * 码表（4 MB）每个编码器一份，每帧、每次清除只清用过的格子。
 */
internal class Lzw {
  private companion object {
    const val CLEAR = 256
    const val END = 257
    const val MAX_CODES = 4096
  }

  /** (前缀码 << 8 | 下一个字节) → 码；0 表示没有。 */
  private val table = IntArray(MAX_CODES shl 8)
  private val used = IntArray(MAX_CODES)
  private var usedCount = 0

  private fun clearTable() {
    for (u in 0 until usedCount) table[used[u]] = 0
    usedCount = 0
  }

  fun encode(indices: ByteArray, out: OutputStream) {
    out.write(8)
    val bits = BlockWriter(out)
    clearTable()
    var codeSize = 9
    var next = END + 1
    bits.write(CLEAR, codeSize)
    if (indices.isEmpty()) {
      bits.write(END, codeSize)
      bits.finish()
      return
    }
    var prefix = indices[0].toInt() and 0xFF
    for (i in 1 until indices.size) {
      val k = indices[i].toInt() and 0xFF
      val key = (prefix shl 8) or k
      val code = table[key]
      if (code != 0) {
        prefix = code
        continue
      }
      bits.write(prefix, codeSize)
      if (next < MAX_CODES) {
        table[key] = next
        used[usedCount++] = key
        // 解码器在读到下一个码之前加上这一项：码表的下一项到 2^codeSize 时加长一位。
        if (next == (1 shl codeSize) && codeSize < 12) codeSize++
        next++
      } else {
        bits.write(CLEAR, codeSize)
        clearTable()
        codeSize = 9
        next = END + 1
      }
      prefix = k
    }
    bits.write(prefix, codeSize)
    bits.write(END, codeSize)
    bits.finish()
  }

  /** 低位在前地拼码，满 255 字节写一个数据块。 */
  private class BlockWriter(private val out: OutputStream) {
    private val block = ByteArray(255)
    private var size = 0
    private var acc = 0L
    private var count = 0

    fun write(code: Int, bits: Int) {
      acc = acc or (code.toLong() shl count)
      count += bits
      while (count >= 8) {
        put((acc and 0xFF).toInt())
        acc = acc ushr 8
        count -= 8
      }
    }

    fun finish() {
      if (count > 0) put((acc and 0xFF).toInt())
      if (size > 0) flushBlock()
      out.write(0)
    }

    private fun put(byte: Int) {
      block[size++] = byte.toByte()
      if (size == 255) flushBlock()
    }

    private fun flushBlock() {
      out.write(size)
      out.write(block, 0, size)
      size = 0
    }
  }
}
