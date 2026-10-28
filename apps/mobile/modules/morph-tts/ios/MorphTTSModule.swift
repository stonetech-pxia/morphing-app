import AVFoundation
import ExpoModulesCore

// 文字转语音（D-268）：只用 iOS 自带的 AVSpeechSynthesizer，在本机把文字读成音频文件，不播放。
// 每段一个 AVSpeechUtterance，write(_:toBufferCallback:) 交回的 PCM 依次写进同一个 WAV（16 位）。
// 声音用系统里这种语言质量最好的一个（用户在「设置 → 辅助功能 → 朗读内容 → 声音」里下载的增强 / 高级声音优先），
// 不用 Albert 这类趣味声音和个人声音。文字只交给系统朗读，不写日志。

private func ttsError(_ code: String, _ reason: String) -> Exception {
  Exception(name: "TTSError", description: reason, code: code)
}

private let noVoice = { (voice: String) in ttsError("ERR_TTS_NO_VOICE", "No voice for \(voice)") }
private let cancelled = { ttsError("ERR_TTS_CANCELLED", "Cancelled") }
private let failed = { (detail: String) in ttsError("ERR_TTS_FAILED", detail) }

/** 一段多久没有新的声音就算卡住（系统朗读比实时快很多，正常不会停这么久）。 */
private let stallSeconds: TimeInterval = 30

struct SynthesizeOptions: Record {
  @Field var taskId: String = ""
  @Field var voice: String = ""
  @Field var rate: Double = 1
  @Field var output: String = ""
}

public class MorphTTSModule: Module {
  /** 正在进行的朗读，取消用（用 lock 保护）。 */
  private var running: [String: TTSJob] = [:]
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("MorphTTS")

    Events("onProgress")

    // iOS 的声音由系统管理：有就是 installed，没有就是 unsupported（没有「还没下载」这一态可查）。
    AsyncFunction("voiceStatus") { (voice: String) -> String in
      Self.pickVoice(voice) == nil ? "unsupported" : "installed"
    }

    AsyncFunction("synthesize") { (segments: [String], options: SynthesizeOptions) async throws -> [String: Any] in
      try await self.synthesize(segments, options)
    }

    Function("cancel") { (taskId: String) in
      self.lock.lock()
      let job = self.running[taskId]
      self.lock.unlock()
      job?.cancel()
    }
  }

  /** 这种语言（BCP 47：zh-CN）质量最好的系统声音。中文不退到别的地区（zh-HK 是粤语）。 */
  static func pickVoice(_ tag: String) -> AVSpeechSynthesisVoice? {
    let wanted = tag.lowercased().replacingOccurrences(of: "_", with: "-")
    let base = String(wanted.prefix { $0 != "-" })
    let voices = AVSpeechSynthesisVoice.speechVoices().filter { voice in
      if #available(iOS 17.0, *) {
        if voice.voiceTraits.contains(.isNoveltyVoice) || voice.voiceTraits.contains(.isPersonalVoice) {
          return false
        }
      }
      return true
    }
    let language = { (v: AVSpeechSynthesisVoice) in v.language.lowercased().replacingOccurrences(of: "_", with: "-") }
    var candidates = voices.filter { language($0) == wanted }
    if candidates.isEmpty && base != "zh" {
      candidates = voices.filter { language($0) == base || language($0).hasPrefix(base + "-") }
    }
    return candidates.max { $0.quality.rawValue < $1.quality.rawValue }
  }

  /** 1 是正常语速：AVSpeechUtterance 的语速不是线性的（默认 0.5，范围 0–1），按两边分别换算。 */
  static func utteranceRate(_ rate: Double) -> Float {
    let r = Float(min(2, max(0.5, rate)))
    let normal = AVSpeechUtteranceDefaultSpeechRate
    if r <= 1 { return normal - (normal - AVSpeechUtteranceMinimumSpeechRate) * (1 - r) }
    return normal + (AVSpeechUtteranceMaximumSpeechRate - normal) * (r - 1) / 2
  }

  private static func fileURL(_ uri: String) -> URL {
    if let url = URL(string: uri), url.isFileURL { return url }
    return URL(fileURLWithPath: uri)
  }

  private func synthesize(_ segments: [String], _ options: SynthesizeOptions) async throws -> [String: Any] {
    guard !segments.isEmpty else { throw failed("nothing to read") }
    guard let voice = Self.pickVoice(options.voice) else { throw noVoice(options.voice) }
    let output = Self.fileURL(options.output)
    let taskId = options.taskId
    let job = TTSJob()
    setJob(taskId, job)
    defer { setJob(taskId, nil) }
    let writer = WavWriter(url: output)
    do {
      try FileManager.default.createDirectory(
        at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? FileManager.default.removeItem(at: output)
      for (i, text) in segments.enumerated() {
        if job.isCancelled { throw CancellationError() }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice
        utterance.rate = Self.utteranceRate(options.rate)
        try await job.write(utterance) { buffer in try writer.append(buffer) }
        sendEvent("onProgress", ["taskId": taskId, "fraction": Double(i + 1) / Double(segments.count)])
      }
      if job.isCancelled { throw CancellationError() }
      guard let result = writer.finish() else { throw failed("the voice wrote no audio") }
      let size = (try? FileManager.default.attributesOfItem(atPath: output.path)[.size] as? NSNumber)?.doubleValue ?? 0
      return [
        "uri": output.absoluteString,
        "size": size,
        "durationMs": result.durationMs,
        "sampleRate": result.sampleRate,
        "channels": result.channels,
      ]
    } catch {
      // 失败、取消都不留半个文件。
      _ = writer.finish()
      try? FileManager.default.removeItem(at: output)
      if job.isCancelled || error is CancellationError { throw cancelled() }
      if let exception = error as? Exception { throw exception }
      throw failed(error.localizedDescription)
    }
  }

  private func setJob(_ id: String, _ job: TTSJob?) {
    lock.lock()
    running[id] = job
    lock.unlock()
  }
}

/**
 * 一次朗读：每段等系统交回最后一个（空的）缓冲区或 didFinish；取消、出错、卡住时都让等待结束，
 * 所以 synthesize 的 Promise 一定会结束。
 */
private final class TTSJob: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
  private let synthesizer = AVSpeechSynthesizer()
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Void, Error>?
  /** 正在等的那一段：上一段晚到的 didFinish 不能结束这一段。 */
  private var current: AVSpeechUtterance?
  private var cancelled = false
  private var lastActivity = Date()

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  var isCancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelled
  }

  func write(_ utterance: AVSpeechUtterance, append: @escaping (AVAudioPCMBuffer) throws -> Void) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      lock.lock()
      if cancelled {
        lock.unlock()
        cont.resume(throwing: CancellationError())
        return
      }
      continuation = cont
      current = utterance
      lastActivity = Date()
      lock.unlock()
      watch(utterance)
      synthesizer.write(utterance) { [weak self] buffer in
        guard let self else { return }
        guard let pcm = buffer as? AVAudioPCMBuffer else { return }
        // 最后交回一个空的缓冲区：这一段读完了。
        if pcm.frameLength == 0 {
          self.finish(nil, of: utterance)
          return
        }
        self.touch()
        do {
          try append(pcm)
        } catch {
          self.synthesizer.stopSpeaking(at: .immediate)
          self.finish(error, of: utterance)
        }
      }
    }
  }

  func cancel() {
    lock.lock()
    cancelled = true
    lock.unlock()
    synthesizer.stopSpeaking(at: .immediate)
    finish(CancellationError())
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    finish(nil, of: utterance)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    finish(CancellationError(), of: utterance)
  }

  private func touch() {
    lock.lock()
    lastActivity = Date()
    lock.unlock()
  }

  /** 结束这一段的等待（只结束一次，后到的忽略）；of 不是正在等的那一段时什么都不做。 */
  private func finish(_ error: Error?, of utterance: AVSpeechUtterance? = nil) {
    lock.lock()
    if let utterance, utterance !== current {
      lock.unlock()
      return
    }
    let cont = continuation
    continuation = nil
    current = nil
    lock.unlock()
    if let error { cont?.resume(throwing: error) } else { cont?.resume() }
  }

  /** 卡住检查：每秒看一次，太久没有新的声音就当作失败。 */
  private func watch(_ utterance: AVSpeechUtterance) {
    DispatchQueue.global().asyncAfter(deadline: .now() + 1) { [weak self] in
      guard let self else { return }
      self.lock.lock()
      let waiting = self.continuation != nil && self.current === utterance
      let stalled = Date().timeIntervalSince(self.lastActivity) > stallSeconds
      self.lock.unlock()
      guard waiting else { return }
      if stalled {
        self.synthesizer.stopSpeaking(at: .immediate)
        self.finish(failed("the voice stopped responding"), of: utterance)
      } else {
        self.watch(utterance)
      }
    }
  }
}

/** 把系统交回的 PCM 写进一个 16 位 WAV；格式变了（极少见）时换成第一段的格式再写。 */
private final class WavWriter: @unchecked Sendable {
  private let url: URL
  private var file: AVAudioFile?
  private var converter: AVAudioConverter?
  private var frames: AVAudioFramePosition = 0

  init(url: URL) { self.url = url }

  func append(_ buffer: AVAudioPCMBuffer) throws {
    if file == nil {
      let format = buffer.format
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: format.sampleRate,
        AVNumberOfChannelsKey: format.channelCount,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
      ]
      file = try AVAudioFile(
        forWriting: url, settings: settings, commonFormat: format.commonFormat, interleaved: format.isInterleaved)
    }
    guard let file else { return }
    let target = file.processingFormat
    if buffer.format == target {
      try file.write(from: buffer)
    } else {
      try file.write(from: try convert(buffer, to: target))
    }
    frames += AVAudioFramePosition(buffer.frameLength)
  }

  private func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) throws -> AVAudioPCMBuffer {
    if converter?.inputFormat != buffer.format { converter = AVAudioConverter(from: buffer.format, to: format) }
    guard let converter else { throw failed("cannot convert \(buffer.format) to \(format)") }
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate) + 1024
    guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { throw failed("no buffer") }
    var given = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if given {
        status.pointee = .noDataNow
        return nil
      }
      given = true
      status.pointee = .haveData
      return buffer
    }
    if let error { throw failed(error.localizedDescription) }
    return out
  }

  /** 关上文件；一点声音都没写时返回 nil。 */
  func finish() -> (durationMs: Double, sampleRate: Double, channels: Int)? {
    guard let file else { return nil }
    let format = file.fileFormat
    let result = (
      durationMs: Double(file.length) / format.sampleRate * 1000,
      sampleRate: format.sampleRate,
      channels: Int(format.channelCount)
    )
    // AVAudioFile 在释放时写好 WAV 头、关上文件。
    self.file = nil
    converter = nil
    return frames > 0 ? result : nil
  }
}
