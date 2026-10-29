package expo.modules.morphvision

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel

// 跑一个只有一个 float32 输入、一个 float32 输出的 ONNX 模型（D-274：扫描展平的 UVDoc 网格模型），
// 和 iOS 的 ModelRunner.swift 一样：输入、输出都走本次运行的临时文件（float32 小端），前后处理在 JS。
// 模型按路径缓存（同一时间只留一个，换模型时释放旧的）。
object ModelRunner {
  private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
  private var loaded: String? = null
  private var session: OrtSession? = null

  /** 返回输出的形状；输出写成 float32 文件。 */
  @Synchronized
  fun run(model: String, input: File, shape: LongArray, output: File): List<Long> {
    if (loaded != model || session == null) {
      unload()
      val options = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(Runtime.getRuntime().availableProcessors().coerceIn(1, 4))
      }
      session = env.createSession(model, options)
      loaded = model
    }
    val s = session ?: throw IllegalStateException("model not loaded")
    val count = shape.fold(1L) { a, b -> a * b }
    require(input.length() == count * 4) { "input has ${input.length()} bytes, expected ${count * 4}" }
    val buffer = RandomAccessFile(input, "r").use { raf ->
      raf.channel.map(FileChannel.MapMode.READ_ONLY, 0, count * 4).order(ByteOrder.LITTLE_ENDIAN)
    }
    OnnxTensor.createTensor(env, buffer.asFloatBuffer(), shape).use { tensor ->
      s.run(mapOf(s.inputNames.first() to tensor)).use { result ->
        val out = result[0] as OnnxTensor
        val floats = out.floatBuffer
        val bytes = ByteBuffer.allocate(floats.remaining() * 4).order(ByteOrder.LITTLE_ENDIAN)
        bytes.asFloatBuffer().put(floats)
        output.writeBytes(bytes.array())
        return out.info.shape.toList()
      }
    }
  }

  @Synchronized
  fun unload() {
    session?.close()
    session = null
    loaded = null
  }
}
