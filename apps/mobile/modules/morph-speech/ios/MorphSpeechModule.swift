import AVFoundation
import CryptoKit
import ExpoModulesCore
import Speech

// 语音转文字（D-150）：只用 iOS 自带的 Speech 框架，全部在本机识别。
// iOS 26 起用 SpeechAnalyzer：优先 SpeechTranscriber（长录音更准、更快）；这台设备没有它（模拟器上
// isAvailable 是 false）或它不支持这种语言（俄语、越南语）时用 DictationTranscriber（系统听写的模型，
// 语言更多）。识别模型由系统管理、所有 App 共用。更早的系统退回 SFSpeechRecognizer，并要求只在本机识别
// （requiresOnDeviceRecognition）。
// 识别出的文字只返回给 App，不写日志。

private func speechError(_ code: String, _ reason: String) -> Exception {
  Exception(name: "SpeechError", description: reason, code: code)
}

private let unsupportedLanguage = { (lang: String) in
  speechError("ERR_SPEECH_UNSUPPORTED_LANGUAGE", "Speech recognition does not support \(lang) on this device")
}
private let needsDownload = { (lang: String) in
  speechError("ERR_SPEECH_NEEDS_DOWNLOAD", "The speech model for \(lang) has to be downloaded first")
}
private let notAuthorized = { speechError("ERR_SPEECH_NOT_AUTHORIZED", "Speech recognition is not allowed") }
private let unreadableAudio = { (detail: String) in
  speechError("ERR_SPEECH_UNREADABLE_AUDIO", "Could not read the audio: \(detail)")
}
private let cancelled = { speechError("ERR_SPEECH_CANCELLED", "Cancelled") }
private let unavailable = {
  speechError("ERR_SPEECH_UNAVAILABLE", "Speech recognition is not available on this device")
}

struct TranscribeOptions: Record {
  @Field var taskId: String = ""
  @Field var language: String = ""
  @Field var model: String?
  @Field var prompt: String?
  @Field var legacy: Bool = false
  @Field var timed: Bool = false
}

public class MorphSpeechModule: Module {
  /** 正在进行的识别，取消用（用 lock 保护）。 */
  private var running: [String: Task<[String: Any], Error>] = [:]
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("MorphSpeech")

    Events("onProgress")

    Constant("engine") { "system" }

    AsyncFunction("supportedLanguages") { () async -> [String] in
      await Self.supportedLanguages()
    }

    AsyncFunction("languageStatus") { (language: String) async -> String in
      await Self.languageStatus(language)
    }

    AsyncFunction("prepareLanguage") { (language: String, taskId: String) async throws in
      try await self.prepareLanguage(language, taskId: taskId)
    }

    AsyncFunction("transcribe") { (uri: URL, options: TranscribeOptions) async throws -> [String: Any] in
      try await self.transcribe(uri, options)
    }

    Function("cancel") { (taskId: String) in
      self.cancel(taskId)
    }

    AsyncFunction("sha256File") { (uri: URL) throws -> String in
      try Self.sha256(uri)
    }
  }

  private static func supportedLanguages() async -> [String] {
    var codes = Set(
      SFSpeechRecognizer.supportedLocales()
        .filter { SFSpeechRecognizer(locale: $0)?.supportsOnDeviceRecognition == true }
        .map { $0.identifier(.bcp47) })
    if #available(iOS 26.0, *) {
      if SpeechTranscriber.isAvailable {
        codes.formUnion(await SpeechTranscriber.supportedLocales.map { $0.identifier(.bcp47) })
      }
      codes.formUnion(await DictationTranscriber.supportedLocales.map { $0.identifier(.bcp47) })
    }
    return codes.sorted()
  }

  private static func languageStatus(_ language: String) async -> String {
    if #available(iOS 26.0, *), let module = await analyzerModule(language) {
      var status = await AssetInventory.status(forModules: [module])
      // 模型已经在手机上（别的 App 或系统听写下载过）时，占一个名额就能用，不用再问用户下载（占名额不联网）。
      if status == .supported, let locale = (module as? any LocaleDependentSpeechModule)?.selectedLocales.first,
        (try? await AssetInventory.reserve(locale: locale)) == true
      {
        status = await AssetInventory.status(forModules: [module])
      }
      switch status {
      case .installed: return "installed"
      case .supported, .downloading: return "needsDownload"
      default: return "unsupported"
      }
    }
    // iOS 26 以前，或 SpeechAnalyzer 不支持的语言：看旧接口能不能在本机识别。
    return legacyRecognizer(language) == nil ? "unsupported" : "installed"
  }

  private func prepareLanguage(_ language: String, taskId: String) async throws {
    guard #available(iOS 26.0, *) else { return }
    guard let module = await Self.analyzerModule(language) else { return }
    // 先占一个语言名额（系统限制每个 App 同时保留几种语言），不然状态一直是 supported。
    if let locale = (module as? any LocaleDependentSpeechModule)?.selectedLocales.first {
      _ = try? await AssetInventory.reserve(locale: locale)
    }
    guard let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) else { return }
    let observation = request.progress.observe(\.fractionCompleted) { [weak self] progress, _ in
      self?.sendEvent("onProgress", ["taskId": taskId, "fraction": progress.fractionCompleted])
    }
    defer { observation.invalidate() }
    try await request.downloadAndInstall()
  }

  private func transcribe(_ uri: URL, _ options: TranscribeOptions) async throws -> [String: Any] {
    let taskId = options.taskId
    let language = options.language
    let legacy = options.legacy
    let task = Task { [weak self] () throws -> [String: Any] in
      let file: AVAudioFile
      do {
        file = try AVAudioFile(forReading: uri)
      } catch {
        throw unreadableAudio(error.localizedDescription)
      }
      let durationMs = Double(file.length) / file.fileFormat.sampleRate * 1000
      guard durationMs > 0 else { throw unreadableAudio("empty") }
      let progress: (Double) -> Void = { endMs in
        self?.sendEvent("onProgress", ["taskId": taskId, "fraction": min(1, endMs / durationMs)])
      }
      let segments: [[String: Any]]
      if #available(iOS 26.0, *), !legacy, let module = await Self.analyzerModule(language) {
        segments = try await Self.analyze(file: file, module: module, language: language, progress: progress)
      } else {
        segments = try await Self.recognizeLegacy(url: uri, language: language, timed: options.timed, progress: progress)
      }
      return ["segments": segments, "durationMs": durationMs]
    }
    setTask(taskId, task)
    defer { setTask(taskId, nil) }
    do {
      return try await task.value
    } catch is CancellationError {
      throw cancelled()
    }
  }

  private func cancel(_ taskId: String) {
    lock.lock()
    let task = running[taskId]
    lock.unlock()
    task?.cancel()
  }

  // 边读边算 SHA-256，一次 4 MB。
  private static func sha256(_ uri: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: uri)
    defer { try? handle.close() }
    var hasher = SHA256()
    while let chunk = try handle.read(upToCount: 4 << 20), !chunk.isEmpty {
      hasher.update(data: chunk)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  private func setTask(_ id: String, _ task: Task<[String: Any], Error>?) {
    lock.lock()
    running[id] = task
    lock.unlock()
  }

  // MARK: - iOS 26 起：SpeechAnalyzer

  /** 这种语言用哪个 SpeechAnalyzer 模块；都不支持时为 nil。 */
  @available(iOS 26.0, *)
  private static func analyzerModule(_ language: String) async -> (any SpeechModule)? {
    let wanted = Locale(identifier: language)
    if SpeechTranscriber.isAvailable, let locale = await SpeechTranscriber.supportedLocale(equivalentTo: wanted) {
      return SpeechTranscriber(
        locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
    }
    if let locale = await DictationTranscriber.supportedLocale(equivalentTo: wanted) {
      return DictationTranscriber(
        locale: locale, contentHints: [], transcriptionOptions: [.punctuation], reportingOptions: [],
        attributeOptions: [.audioTimeRange])
    }
    return nil
  }

  @available(iOS 26.0, *)
  private static func analyze(
    file: AVAudioFile, module: any SpeechModule, language: String, progress: @escaping (Double) -> Void
  ) async throws -> [[String: Any]] {
    // 识别模型由系统下载（prepareLanguage）；这里不偷偷下载（D-064：下载要用户确认）。
    guard await AssetInventory.status(forModules: [module]) == .installed else {
      throw needsDownload(language)
    }
    let analyzer = SpeechAnalyzer(modules: [module])
    let collect = Task { () throws -> [[String: Any]] in
      var segments: [[String: Any]] = []
      func add(_ text: AttributedString, _ range: CMTimeRange) {
        let string = String(text.characters)
        let end = range.end.seconds * 1000
        if !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          segments.append(["startMs": range.start.seconds * 1000, "endMs": end, "text": string])
        }
        progress(end)
      }
      if let transcriber = module as? SpeechTranscriber {
        for try await result in transcriber.results { add(result.text, result.range) }
      } else if let dictation = module as? DictationTranscriber {
        for try await result in dictation.results { add(result.text, result.range) }
      }
      return segments
    }
    // analyzeSequence(from: file) 不转换格式（模拟器上 DictationTranscriber 报「Audio format is not supported」），
    // 所以自己一块一块读出来，转成识别器要的格式再喂进去。
    // 没有能用的格式时不能硬喂（会在系统里崩溃）：模拟器上就是这样，模型「已安装」但一种格式也没有。
    guard
      let format = await SpeechAnalyzer.bestAvailableAudioFormat(
        compatibleWith: [module], considering: file.processingFormat)
    else { throw unavailable() }
    let input = try audioInput(file: file, format: format)
    do {
      try await withTaskCancellationHandler {
        if let last = try await analyzer.analyzeSequence(input) {
          try await analyzer.finalizeAndFinish(through: last)
        } else {
          await analyzer.cancelAndFinishNow()
        }
      } onCancel: {
        Task { await analyzer.cancelAndFinishNow() }
      }
      try Task.checkCancellation()
      return try await collect.value
    } catch {
      collect.cancel()
      throw error
    }
  }

  /** 把文件按 1 秒一块读出来、转成 format，作为识别器的输入。 */
  @available(iOS 26.0, *)
  private static func audioInput(file: AVAudioFile, format: AVAudioFormat) throws -> AsyncThrowingStream<
    AnalyzerInput, Error
  > {
    let source = file.processingFormat
    let converter = source == format ? nil : AVAudioConverter(from: source, to: format)
    if source != format && converter == nil { throw unreadableAudio("cannot convert \(source) to \(format)") }
    let chunk = AVAudioFrameCount(source.sampleRate)
    return AsyncThrowingStream { cont in
      let feeder = Task {
        do {
          var finished = false
          while !finished {
            try Task.checkCancellation()
            guard let buffer = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: chunk) else { break }
            try file.read(into: buffer, frameCount: chunk)
            finished = buffer.frameLength < chunk
            guard let converter else {
              if buffer.frameLength > 0 { cont.yield(AnalyzerInput(buffer: buffer)) }
              continue
            }
            let capacity = AVAudioFrameCount(Double(chunk) * format.sampleRate / source.sampleRate) + 1024
            guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { break }
            var given = false
            var error: NSError?
            converter.convert(to: out, error: &error) { _, status in
              if given {
                status.pointee = finished ? .endOfStream : .noDataNow
                return nil
              }
              given = true
              status.pointee = buffer.frameLength > 0 ? .haveData : .endOfStream
              return buffer.frameLength > 0 ? buffer : nil
            }
            if let error { throw unreadableAudio(error.localizedDescription) }
            if out.frameLength > 0 { cont.yield(AnalyzerInput(buffer: out)) }
          }
          cont.finish()
        } catch {
          cont.finish(throwing: error)
        }
      }
      cont.onTermination = { _ in feeder.cancel() }
    }
  }

  // MARK: - 更早的系统：SFSpeechRecognizer，只在本机识别

  private static func legacyRecognizer(_ language: String) -> SFSpeechRecognizer? {
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)),
      recognizer.supportsOnDeviceRecognition
    else { return nil }
    return recognizer
  }

  private static func authorize() async -> Bool {
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: return true
    case .notDetermined:
      return await withCheckedContinuation { cont in
        SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0 == .authorized) }
      }
    default: return false
    }
  }

  private static func recognizeLegacy(
    url: URL, language: String, timed: Bool, progress: @escaping (Double) -> Void
  ) async throws -> [[String: Any]] {
    guard let recognizer = legacyRecognizer(language) else { throw unsupportedLanguage(language) }
    guard await authorize() else { throw notAuthorized() }
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    request.addsPunctuation = true
    let box = LegacyTaskBox()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (cont: CheckedContinuation<[[String: Any]], Error>) in
        var segments: [[String: Any]] = []
        var finished = false
        box.task = recognizer.recognitionTask(with: request) { result, error in
          guard !finished else { return }
          if let result {
            let words = result.bestTranscription.segments
            let start = (words.first?.timestamp ?? 0) * 1000
            let end = words.last.map { ($0.timestamp + $0.duration) * 1000 } ?? start
            if result.isFinal {
              if timed {
                // 使用系统实际的词时间戳，不把整段录音伪装成一个字幕。
                for word in words {
                  segments.append(["startMs": word.timestamp*1000, "endMs": (word.timestamp+word.duration)*1000, "text": word.substring])
                }
              } else {
                let text = result.bestTranscription.formattedString
                if !text.isEmpty { segments.append(["startMs": start, "endMs": end, "text": text]) }
              }
              finished = true
              cont.resume(returning: segments)
              return
            }
            progress(end)
          }
          if let error {
            finished = true
            // 没有听到任何话时系统报错（kAFAssistantErrorDomain 1110），当成空结果。
            let ns = error as NSError
            if ns.code == 1110 || ns.code == 203 {
              cont.resume(returning: segments)
            } else if box.cancelled {
              cont.resume(throwing: CancellationError())
            } else {
              // 文件前面已经用 AVAudioFile 打开过，这里的失败是识别器的（模拟器上是「Failed to initialize recognizer」）。
              cont.resume(throwing: speechError("ERR_SPEECH_UNAVAILABLE", error.localizedDescription))
            }
          }
        }
      }
    } onCancel: {
      box.cancelled = true
      box.task?.cancel()
    }
  }
}

private final class LegacyTaskBox: @unchecked Sendable {
  var task: SFSpeechRecognitionTask?
  var cancelled = false
}
