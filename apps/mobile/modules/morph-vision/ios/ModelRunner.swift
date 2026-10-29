import Foundation
import onnxruntime_objc

// 跑一个只有一个 float32 输入、一个 float32 输出的 ONNX 模型（D-274：扫描展平的 UVDoc 网格模型），
// 和 Android 的 ModelRunner.kt 一样：输入、输出都走本次运行的临时文件（float32 小端），前后处理在 JS。
// 模型按路径缓存（同一时间只留一个，换模型时释放旧的）。
final class ModelRunner {
  static let shared = ModelRunner()

  private let lock = NSLock()
  private var env: ORTEnv?
  private var loaded: String?
  private var session: ORTSession?

  /** 返回输出的形状；输出写成 float32 文件。 */
  func run(model: String, input: URL, shape: [Int], output: URL) throws -> [Int] {
    lock.lock()
    defer { lock.unlock() }
    if loaded != model || session == nil {
      session = nil
      let env = try self.env ?? ORTEnv(loggingLevel: .warning)
      self.env = env
      let options = try ORTSessionOptions()
      try options.setIntraOpNumThreads(Int32(min(4, max(1, ProcessInfo.processInfo.activeProcessorCount))))
      session = try ORTSession(env: env, modelPath: model, sessionOptions: options)
      loaded = model
    }
    guard let session else {
      throw NSError(domain: "ModelRunner", code: 3, userInfo: [NSLocalizedDescriptionKey: "model not loaded"])
    }
    let data = try Data(contentsOf: input, options: .alwaysMapped)
    let count = shape.reduce(1, *)
    guard data.count == count * 4 else {
      throw NSError(domain: "ModelRunner", code: 1, userInfo: [NSLocalizedDescriptionKey: "input has \(data.count) bytes, expected \(count * 4)"])
    }
    let tensor = try ORTValue(
      tensorData: NSMutableData(data: data),
      elementType: .float,
      shape: shape.map { NSNumber(value: $0) }
    )
    let inputName = try session.inputNames().first ?? "x"
    let outputName = try session.outputNames().first ?? ""
    let outputs = try session.run(withInputs: [inputName: tensor], outputNames: [outputName], runOptions: nil)
    guard let out = outputs[outputName] else {
      throw NSError(domain: "ModelRunner", code: 2, userInfo: [NSLocalizedDescriptionKey: "no output"])
    }
    let dims = try out.tensorTypeAndShapeInfo().shape.map { $0.intValue }
    try (try out.tensorData() as Data).write(to: output)
    return dims
  }

  func unload() {
    lock.lock()
    defer { lock.unlock() }
    session = nil
    loaded = nil
  }
}
