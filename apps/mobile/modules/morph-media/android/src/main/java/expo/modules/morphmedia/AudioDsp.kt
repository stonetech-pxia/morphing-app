package expo.modules.morphmedia

/** 共享的 LUFS/峰值分析器（libebur128，MIT）。每个任务单独持有状态。 */
object AudioDsp {
  init { System.loadLibrary("morphdsp") }
  @JvmStatic external fun nativeCreate(rate: Int, channels: Int): Long
  @JvmStatic external fun nativeAdd(handle: Long, pcm: ShortArray, count: Int): Int
  @JvmStatic external fun nativeGain(handle: Long, automatic: Boolean, db: Double): Double
  @JvmStatic external fun nativeDestroy(handle: Long)
}
