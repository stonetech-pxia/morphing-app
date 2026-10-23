import AVFoundation
import ExpoModulesCore
import UIKit

// 视频和音频的 iOS 实现（D-141）：只用 AVFoundation，全部在本机处理，不联网。
// - probe：AVURLAsset 读时长、宽高、方向、帧率、码率、编码、是否 HDR。
// - transcode：AVAssetReader（经过 AVVideoComposition：摆正、缩小、限帧率、HDR 转 BT.709）
//   + AVAssetWriter（H.264 + AAC，MP4），自己指定码率。
// - trim：AVAssetExportSession 的 Passthrough + timeRange，不重新编码。
// - thumbnails：AVAssetImageGenerator。
// 视频编码器不能在后台用：处理时切到别的 App 会失败，报 ERR_MEDIA_INTERRUPTED（D-148）。

final class MediaUnsupportedException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_MEDIA_UNSUPPORTED" }
  override var reason: String { "This media can't be opened: \(param)" }
}

final class MediaCancelledException: Exception, @unchecked Sendable {
  override var code: String { "ERR_MEDIA_CANCELLED" }
  override var reason: String { "Cancelled" }
}

final class MediaInterruptedException: Exception, @unchecked Sendable {
  override var code: String { "ERR_MEDIA_INTERRUPTED" }
  override var reason: String { "Morph went to the background while processing" }
}

final class NotImplementedException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_NOT_IMPLEMENTED" }
  override var reason: String { "Not implemented yet: \(param)" }
}

final class MediaFailedException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_MEDIA_FAILED" }
  override var reason: String { "Processing failed: \(param)" }
}

/** 一个正在进行的任务：能取消，记得有没有切到后台过。 */
private final class Job: @unchecked Sendable {
  private let lock = NSLock()
  private var _cancelled = false
  private var _backgrounded = false
  private var _onCancel: (() -> Void)?

  /** 取消时要做的事（停止读写或导出）；设置时已经取消了就马上做。 */
  var onCancel: (() -> Void)? {
    get { lock.withLock { _onCancel } }
    set {
      let run = lock.withLock { () -> Bool in
        _onCancel = newValue
        return _cancelled
      }
      if run { newValue?() }
    }
  }

  var cancelled: Bool { lock.withLock { _cancelled } }
  var backgrounded: Bool { lock.withLock { _backgrounded } }

  func cancel() {
    let handler: (() -> Void)? = lock.withLock {
      _cancelled = true
      return _onCancel
    }
    handler?()
  }

  func markBackgrounded() { lock.withLock { _backgrounded = true } }
}

public class MorphMediaModule: Module {
  private let jobsLock = NSLock()
  private var jobs: [String: Job] = [:]

  public func definition() -> ModuleDefinition {
    Name("MorphMedia")

    Events("progress")

    AsyncFunction("probe") { (uri: URL, promise: Promise) in
      Task {
        do {
          promise.resolve(try await Self.probe(uri))
        } catch {
          promise.reject(Self.coded(error))
        }
      }
    }

    AsyncFunction("transcode") {
      (jobId: String, uri: URL, output: URL, options: [String: Any], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do {
          let result = try await self.transcode(job, jobId: jobId, uri: uri, output: output, options: options)
          promise.resolve(result)
        } catch {
          promise.reject(Self.coded(error, job: job))
        }
      }
    }

    AsyncFunction("trim") {
      (jobId: String, uri: URL, output: URL, range: [String: Double], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do {
          let result = try await self.trim(job, jobId: jobId, uri: uri, output: output, range: range)
          promise.resolve(result)
        } catch {
          promise.reject(Self.coded(error, job: job))
        }
      }
    }

    AsyncFunction("thumbnails") {
      (uri: URL, timesMs: [Double], maxSide: Double, directory: URL, promise: Promise) in
      Task {
        do {
          promise.resolve(try await Self.thumbnails(uri, timesMs: timesMs, maxSide: maxSide, directory: directory))
        } catch {
          promise.reject(Self.coded(error))
        }
      }
    }

    // 音频（D-153、D-155，音频会话）：几段接成一段、波形。
    AsyncFunction("concat") {
      (jobId: String, uris: [URL], output: URL, options: [String: Any], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do {
          let result = try await self.concat(job, jobId: jobId, uris: uris, output: output, options: options)
          promise.resolve(result)
        } catch {
          promise.reject(Self.coded(error, job: job))
        }
      }
    }

    AsyncFunction("waveform") { (uri: URL, buckets: Int, range: [String: Double]?, promise: Promise) in
      Task {
        do {
          promise.resolve(try await Self.waveform(uri, buckets: buckets, range: range))
        } catch {
          promise.reject(Self.coded(error))
        }
      }
    }

    Function("cancel") { (jobId: String) in
      let job = self.jobsLock.withLock { self.jobs[jobId] }
      job?.cancel()
    }
  }

  // MARK: - 任务

  private func start(_ jobId: String) -> Job {
    let job = Job()
    // 切到后台时记一下：之后编码失败就是因为这个（iOS 不让后台用视频编码器）。
    let token = NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil
    ) { _ in job.markBackgrounded() }
    jobsLock.withLock {
      jobs[jobId] = job
      observers[jobId] = token
    }
    return job
  }

  private var observers: [String: NSObjectProtocol] = [:]

  private func finish(_ jobId: String) {
    jobsLock.withLock {
      jobs[jobId] = nil
      if let token = observers.removeValue(forKey: jobId) {
        NotificationCenter.default.removeObserver(token)
      }
    }
  }

  private func progress(_ jobId: String, _ value: Double) {
    sendEvent("progress", ["jobId": jobId, "progress": min(1, max(0, value))])
  }

  private static func coded(_ error: Error, job: Job? = nil) -> Exception {
    if let job, job.cancelled { return MediaCancelledException() }
    if let exception = error as? Exception { return exception }
    if let job, job.backgrounded { return MediaInterruptedException() }
    return MediaFailedException(error.localizedDescription)
  }

  // MARK: - probe

  static func probe(_ url: URL) async throws -> [String: Any] {
    let asset = AVURLAsset(url: url)
    let duration: CMTime
    let tracks: [AVAssetTrack]
    do {
      (duration, tracks) = try await asset.load(.duration, .tracks)
    } catch {
      throw MediaUnsupportedException(error.localizedDescription)
    }
    if (try? await asset.load(.hasProtectedContent)) == true {
      throw MediaUnsupportedException("protected")
    }
    let video = tracks.first { $0.mediaType == .video }
    let audio = tracks.first { $0.mediaType == .audio }
    if video == nil && audio == nil { throw MediaUnsupportedException("no tracks") }
    var info: [String: Any] = [
      "kind": video != nil ? "video" : "audio",
      "durationMs": duration.isNumeric ? duration.seconds * 1000 : 0,
      "size": fileSize(url),
      "hasVideo": video != nil,
      "hasAudio": audio != nil,
    ]
    if let video {
      let (size, transform, fps, rate, formats) = try await video.load(
        .naturalSize, .preferredTransform, .nominalFrameRate, .estimatedDataRate, .formatDescriptions)
      let shown = size.applying(transform)
      info["width"] = Int(abs(shown.width).rounded())
      info["height"] = Int(abs(shown.height).rounded())
      info["rotation"] = rotation(of: transform)
      info["fps"] = Double(fps)
      info["videoBitrateKbps"] = Double(rate) / 1000
      if let format = formats.first {
        info["videoCodec"] = fourCC(CMFormatDescriptionGetMediaSubType(format))
      }
      info["hdr"] = (try? await video.load(.mediaCharacteristics))?.contains(.containsHDRVideo) ?? false
    }
    if let audio {
      let (rate, formats) = try await audio.load(.estimatedDataRate, .formatDescriptions)
      info["audioBitrateKbps"] = Double(rate) / 1000
      if let format = formats.first {
        info["audioCodec"] = fourCC(CMFormatDescriptionGetMediaSubType(format))
        if let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee {
          info["sampleRate"] = asbd.mSampleRate
          info["channels"] = Int(asbd.mChannelsPerFrame)
        }
      }
    }
    return info
  }

  private static func fileSize(_ url: URL) -> Int {
    (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
  }

  private static func rotation(of t: CGAffineTransform) -> Int {
    let degrees = Int((atan2(t.b, t.a) * 180 / .pi).rounded())
    return ((degrees % 360) + 360) % 360
  }

  private static func fourCC(_ code: FourCharCode) -> String {
    let bytes = [24, 16, 8, 0].map { UInt8((code >> $0) & 0xff) }
    let text = String(bytes: bytes, encoding: .ascii) ?? ""
    return text.trimmingCharacters(in: .whitespaces)
  }

  // MARK: - transcode

  private func transcode(
    _ job: Job, jobId: String, uri: URL, output: URL, options: [String: Any]
  ) async throws -> [String: Any] {
    let container = options["container"] as? String ?? "mp4"
    if options["video"] as? String == "drop" {
      let asset = AVURLAsset(url: uri)
      let (duration, tracks) = try await asset.load(.duration, .tracks)
      let audioTracks = tracks.filter { $0.mediaType == .audio }
      if audioTracks.isEmpty { throw MediaUnsupportedException("no audio") }
      var timeRange = CMTimeRange(start: .zero, duration: duration)
      if let range = options["range"] as? [String: Double], let start = range["startMs"], let end = range["endMs"] {
        timeRange = CMTimeRange(
          start: CMTime(seconds: start / 1000, preferredTimescale: 600),
          end: CMTime(seconds: min(end / 1000, duration.seconds), preferredTimescale: 600))
      }
      return try await writeAudio(
        job, jobId: jobId, asset: asset, tracks: audioTracks, timeRange: timeRange, output: output,
        container: container, audio: options["audio"] as? [String: Any] ?? [:])
    }
    guard container == "mp4", let video = options["video"] as? [String: Any] else {
      throw NotImplementedException("transcode to \(container)")
    }
    let audioOptions = options["audio"] as? [String: Any]
    if audioOptions == nil, options["audio"] as? String != "drop" {
      throw NotImplementedException("audio settings")
    }
    if let codec = audioOptions?["codec"] as? String, codec != "aac" {
      throw NotImplementedException("audio codec \(codec)")
    }

    let asset = AVURLAsset(url: uri)
    let (duration, tracks) = try await asset.load(.duration, .tracks)
    guard let videoTrack = tracks.first(where: { $0.mediaType == .video }) else {
      throw MediaUnsupportedException("no video")
    }
    let audioTrack = audioOptions == nil ? nil : tracks.first { $0.mediaType == .audio }

    var timeRange = CMTimeRange(start: .zero, duration: duration)
    if let range = options["range"] as? [String: Double], let start = range["startMs"], let end = range["endMs"] {
      timeRange = CMTimeRange(
        start: CMTime(seconds: start / 1000, preferredTimescale: 600),
        end: CMTime(seconds: end / 1000, preferredTimescale: 600))
    }

    // 输出尺寸：摆正之后按短边缩小，不放大；H.264 要偶数宽高。
    let (natural, transform, nominalFps) = try await videoTrack.load(.naturalSize, .preferredTransform, .nominalFrameRate)
    let shown = natural.applying(transform)
    let shownW = abs(shown.width)
    let shownH = abs(shown.height)
    let shortSide = min(shownW, shownH)
    let maxShort = (video["maxShortSide"] as? Double).map { CGFloat($0) } ?? shortSide
    let scale = min(1, maxShort / max(shortSide, 1))
    let outW = max(2, Int((shownW * scale / 2).rounded()) * 2)
    let outH = max(2, Int((shownH * scale / 2).rounded()) * 2)
    let maxFps = video["maxFps"] as? Double ?? 30
    let fps = min(Double(nominalFps > 0 ? nominalFps : 30), maxFps)

    let composition = AVMutableVideoComposition()
    composition.renderSize = CGSize(width: outW, height: outH)
    composition.frameDuration = CMTime(seconds: 1 / fps, preferredTimescale: 6000)
    // 普通画面（BT.709）：HDR 视频在这里转换，否则发到别处会发灰或过暗。
    composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
    // 摆正：preferredTransform 不一定带平移（不是 iPhone 拍的视频常常只有旋转），
    // 按转过之后的外框把画面挪回原点，再缩放到输出尺寸。
    let bounds = CGRect(origin: .zero, size: natural).applying(transform)
    let upright = transform.concatenating(
      CGAffineTransform(translationX: -bounds.minX, y: -bounds.minY))
    let sx = CGFloat(outW) / shownW
    let sy = CGFloat(outH) / shownH
    layer.setTransform(upright.concatenating(CGAffineTransform(scaleX: sx, y: sy)), at: .zero)
    instruction.layerInstructions = [layer]
    composition.instructions = [instruction]

    let reader: AVAssetReader
    let writer: AVAssetWriter
    do {
      reader = try AVAssetReader(asset: asset)
      try? FileManager.default.removeItem(at: output)
      try FileManager.default.createDirectory(
        at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
      writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    } catch {
      throw MediaFailedException(error.localizedDescription)
    }
    reader.timeRange = timeRange
    writer.shouldOptimizeForNetworkUse = true

    let videoOut = AVAssetReaderVideoCompositionOutput(
      videoTracks: [videoTrack],
      videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
    videoOut.videoComposition = composition
    videoOut.alwaysCopiesSampleData = false
    guard reader.canAdd(videoOut) else { throw MediaUnsupportedException("video output") }
    reader.add(videoOut)

    let bitrate = (video["bitrateKbps"] as? Double ?? 2500) * 1000
    let videoIn = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: outW,
        AVVideoHeightKey: outH,
        AVVideoColorPropertiesKey: [
          AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
          AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
          AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: Int(bitrate),
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
          AVVideoExpectedSourceFrameRateKey: Int(fps.rounded()),
          AVVideoMaxKeyFrameIntervalDurationKey: 2,
        ],
      ])
    videoIn.expectsMediaDataInRealTime = false
    guard writer.canAdd(videoIn) else { throw MediaFailedException("video input") }
    writer.add(videoIn)

    var audioOut: AVAssetReaderAudioMixOutput?
    var audioIn: AVAssetWriterInput?
    if let audioTrack, let audioOptions {
      let kbps = audioOptions["bitrateKbps"] as? Double ?? 128
      // AAC 低码率时用单声道、低采样率，否则编码器不接受。
      let channels = (audioOptions["channels"] as? Int) ?? (kbps < 64 ? 1 : 2)
      let sampleRate = (audioOptions["sampleRate"] as? Double) ?? (kbps < 64 ? 22050 : 44100)
      let out = AVAssetReaderAudioMixOutput(
        audioTracks: [audioTrack],
        audioSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM,
          AVSampleRateKey: sampleRate,
          AVNumberOfChannelsKey: channels,
          AVLinearPCMBitDepthKey: 16,
          AVLinearPCMIsFloatKey: false,
          AVLinearPCMIsBigEndianKey: false,
          AVLinearPCMIsNonInterleaved: false,
        ])
      let input = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVSampleRateKey: sampleRate,
          AVNumberOfChannelsKey: channels,
          AVEncoderBitRateKey: Int(kbps * 1000),
        ])
      input.expectsMediaDataInRealTime = false
      if reader.canAdd(out), writer.canAdd(input) {
        reader.add(out)
        writer.add(input)
        audioOut = out
        audioIn = input
      }
    }

    job.onCancel = {
      reader.cancelReading()
      writer.cancelWriting()
    }
    if job.cancelled { throw MediaCancelledException() }
    guard reader.startReading() else {
      throw MediaUnsupportedException(reader.error?.localizedDescription ?? "reader")
    }
    guard writer.startWriting() else {
      throw MediaFailedException(writer.error?.localizedDescription ?? "writer")
    }
    writer.startSession(atSourceTime: timeRange.start)

    let total = max(timeRange.duration.seconds, 0.001)
    let start = timeRange.start.seconds
    var lastReported = -1.0
    let report: (CMTime) -> Void = { time in
      let value = (time.seconds - start) / total
      if value - lastReported >= 0.01 {
        lastReported = value
        self.progress(jobId, value)
      }
    }

    // 两路（画面、声音）各自在自己的队列上搬运，都搬完再收尾。
    await withTaskGroup(of: Void.self) { group in
      group.addTask {
        await Self.pump(videoOut, into: videoIn, queue: DispatchQueue(label: "morph.media.video"), onSample: report)
      }
      if let audioOut, let audioIn {
        group.addTask {
          await Self.pump(audioOut, into: audioIn, queue: DispatchQueue(label: "morph.media.audio"), onSample: nil)
        }
      }
    }

    if job.cancelled {
      writer.cancelWriting()
      throw MediaCancelledException()
    }
    if reader.status == .failed {
      writer.cancelWriting()
      if job.backgrounded { throw MediaInterruptedException() }
      throw MediaFailedException(reader.error?.localizedDescription ?? "read")
    }
    await writer.finishWriting()
    if writer.status != .completed {
      if job.backgrounded { throw MediaInterruptedException() }
      throw MediaFailedException(writer.error?.localizedDescription ?? "write")
    }
    progress(jobId, 1)
    return try await Self.result(output)
  }

  /** 把一路样本从 reader 搬到 writer，直到读完或写入失败。 */
  private static func pump(
    _ output: AVAssetReaderOutput, into input: AVAssetWriterInput, queue: DispatchQueue,
    onSample: ((CMTime) -> Void)? = nil
  ) async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      var done = false
      input.requestMediaDataWhenReady(on: queue) {
        while input.isReadyForMoreMediaData && !done {
          guard let sample = output.copyNextSampleBuffer() else {
            done = true
            input.markAsFinished()
            continuation.resume()
            return
          }
          onSample?(CMSampleBufferGetPresentationTimeStamp(sample))
          if !input.append(sample) {
            done = true
            input.markAsFinished()
            continuation.resume()
            return
          }
        }
      }
    }
  }

  private static func result(_ url: URL) async throws -> [String: Any] {
    let info = try await probe(url)
    return ["uri": url.absoluteString, "size": fileSize(url), "info": info]
  }

  // MARK: - 音频（D-153、D-155）

  /**
   * 把几路声音（混在一起；合成时它们首尾相接）编码成 M4A（AAC）或 WAV（16 位 PCM）。
   * AAC 低码率时用单声道、低采样率，否则编码器不接受（和视频的声音一样）。
   */
  private func writeAudio(
    _ job: Job, jobId: String, asset: AVAsset, tracks: [AVAssetTrack], timeRange: CMTimeRange,
    output: URL, container: String, audio: [String: Any]
  ) async throws -> [String: Any] {
    let codec = audio["codec"] as? String ?? (container == "wav" ? "pcm" : "aac")
    guard (container == "m4a" && codec == "aac") || (container == "wav" && codec == "pcm") else {
      throw NotImplementedException("\(container) with \(codec)")
    }
    let kbps = audio["bitrateKbps"] as? Double ?? 128
    let channels = audio["channels"] as? Int ?? (codec == "aac" && kbps < 64 ? 1 : 2)
    let sampleRate = audio["sampleRate"] as? Double ?? (codec == "aac" && kbps < 48 ? 22050 : 44100)
    let pcm: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channels,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ]
    let settings: [String: Any] =
      codec == "pcm"
      ? pcm
      : [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: sampleRate,
        AVNumberOfChannelsKey: channels,
        AVEncoderBitRateKey: Int(kbps * 1000),
      ]

    let reader: AVAssetReader
    let writer: AVAssetWriter
    do {
      reader = try AVAssetReader(asset: asset)
      try? FileManager.default.removeItem(at: output)
      try FileManager.default.createDirectory(
        at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
      writer = try AVAssetWriter(outputURL: output, fileType: container == "wav" ? .wav : .m4a)
    } catch {
      throw MediaFailedException(error.localizedDescription)
    }
    reader.timeRange = timeRange
    let out = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: pcm)
    out.alwaysCopiesSampleData = false
    guard reader.canAdd(out) else { throw MediaUnsupportedException("audio output") }
    reader.add(out)
    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    guard writer.canAdd(input) else { throw MediaFailedException("audio input \(kbps) kbps \(channels) ch") }
    writer.add(input)

    job.onCancel = {
      reader.cancelReading()
      writer.cancelWriting()
    }
    if job.cancelled { throw MediaCancelledException() }
    guard reader.startReading() else {
      throw MediaUnsupportedException(reader.error?.localizedDescription ?? "reader")
    }
    guard writer.startWriting() else {
      throw MediaFailedException(writer.error?.localizedDescription ?? "writer")
    }
    writer.startSession(atSourceTime: timeRange.start)

    let total = max(timeRange.duration.seconds, 0.001)
    let start = timeRange.start.seconds
    var lastReported = -1.0
    await Self.pump(out, into: input, queue: DispatchQueue(label: "morph.media.audio")) { time in
      let value = (time.seconds - start) / total
      if value - lastReported >= 0.01 {
        lastReported = value
        self.progress(jobId, value)
      }
    }

    if job.cancelled {
      writer.cancelWriting()
      throw MediaCancelledException()
    }
    if reader.status == .failed {
      writer.cancelWriting()
      if job.backgrounded { throw MediaInterruptedException() }
      throw MediaFailedException(reader.error?.localizedDescription ?? "read")
    }
    await writer.finishWriting()
    if writer.status != .completed {
      if job.backgrounded { throw MediaInterruptedException() }
      throw MediaFailedException(writer.error?.localizedDescription ?? "write")
    }
    progress(jobId, 1)
    return try await Self.result(output)
  }

  /** 几段接成一段：每段放进合成里自己的一路，首尾相接，读的时候混成一路（格式、采样率可以不同）。 */
  private func concat(
    _ job: Job, jobId: String, uris: [URL], output: URL, options: [String: Any]
  ) async throws -> [String: Any] {
    let composition = AVMutableComposition()
    var tracks: [AVAssetTrack] = []
    var cursor = CMTime.zero
    for uri in uris {
      let asset = AVURLAsset(url: uri)
      let (duration, sourceTracks) = try await asset.load(.duration, .tracks)
      guard let source = sourceTracks.first(where: { $0.mediaType == .audio }) else {
        throw MediaUnsupportedException("no audio: \(uri.lastPathComponent)")
      }
      guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw MediaFailedException("composition track")
      }
      do {
        try track.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: source, at: cursor)
      } catch {
        throw MediaUnsupportedException(error.localizedDescription)
      }
      tracks.append(track)
      cursor = cursor + duration
    }
    return try await writeAudio(
      job, jobId: jobId, asset: composition, tracks: tracks,
      timeRange: CMTimeRange(start: .zero, duration: cursor), output: output,
      container: options["container"] as? String ?? "m4a", audio: options["audio"] as? [String: Any] ?? [:])
  }

  /** 波形：解成 8 kHz 单声道，每一份取最大的音量，再按最响的一份归一到 0–1。 */
  static func waveform(_ uri: URL, buckets: Int, range: [String: Double]?) async throws -> [Double] {
    let asset = AVURLAsset(url: uri)
    let (duration, tracks) = try await asset.load(.duration, .tracks)
    let audio = tracks.filter { $0.mediaType == .audio }
    if audio.isEmpty || buckets <= 0 { throw MediaUnsupportedException("no audio") }
    var timeRange = CMTimeRange(start: .zero, duration: duration)
    if let range, let start = range["startMs"], let end = range["endMs"] {
      timeRange = CMTimeRange(
        start: CMTime(seconds: start / 1000, preferredTimescale: 600),
        end: CMTime(seconds: end / 1000, preferredTimescale: 600))
    }
    let rate = 8000.0
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = timeRange
    let out = AVAssetReaderAudioMixOutput(
      audioTracks: audio,
      audioSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: rate,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
      ])
    guard reader.canAdd(out) else { throw MediaUnsupportedException("waveform output") }
    reader.add(out)
    guard reader.startReading() else {
      throw MediaUnsupportedException(reader.error?.localizedDescription ?? "reader")
    }
    let total = max(1, Int(timeRange.duration.seconds * rate))
    var peaks = [Double](repeating: 0, count: buckets)
    var index = 0
    while let sample = out.copyNextSampleBuffer() {
      guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
      let length = CMBlockBufferGetDataLength(block)
      var data = Data(count: length)
      data.withUnsafeMutableBytes { raw in
        _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: raw.baseAddress!)
      }
      data.withUnsafeBytes { raw in
        for value in raw.bindMemory(to: Int16.self) {
          let bucket = min(buckets - 1, index * buckets / total)
          peaks[bucket] = max(peaks[bucket], abs(Double(value)) / 32768)
          index += 1
        }
      }
    }
    let loudest = peaks.max() ?? 0
    return loudest > 0 ? peaks.map { $0 / loudest } : peaks
  }

  // MARK: - trim

  private func trim(
    _ job: Job, jobId: String, uri: URL, output: URL, range: [String: Double]
  ) async throws -> [String: Any] {
    guard let startMs = range["startMs"], let endMs = range["endMs"], endMs > startMs else {
      throw MediaFailedException("range")
    }
    let asset = AVURLAsset(url: uri)
    let timeRange = CMTimeRange(
      start: CMTime(seconds: startMs / 1000, preferredTimescale: 600),
      end: CMTime(seconds: endMs / 1000, preferredTimescale: 600))
    try? FileManager.default.createDirectory(
      at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    // 先按要求的容器（一般是 MP4）；原来的声音放不进 MP4（例如 PCM）时改成 MOV。
    var targets = [output]
    if output.pathExtension.lowercased() == "mp4" {
      targets.append(output.deletingPathExtension().appendingPathExtension("mov"))
    }
    var lastError: Error?
    for target in targets {
      if job.cancelled { throw MediaCancelledException() }
      do {
        try await export(job, jobId: jobId, asset: asset, range: timeRange, to: target)
        progress(jobId, 1)
        return try await Self.result(target)
      } catch let error as MediaCancelledException {
        throw error
      } catch {
        lastError = error
      }
    }
    throw lastError ?? MediaFailedException("trim")
  }

  private func export(_ job: Job, jobId: String, asset: AVAsset, range: CMTimeRange, to url: URL) async throws {
    guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
      throw MediaUnsupportedException("export")
    }
    let type: AVFileType
    switch url.pathExtension.lowercased() {
    case "mov": type = .mov
    case "m4a": type = .m4a
    default: type = .mp4
    }
    guard session.supportedFileTypes.contains(type) else {
      throw MediaUnsupportedException("container \(type.rawValue)")
    }
    try? FileManager.default.removeItem(at: url)
    session.outputURL = url
    session.outputFileType = type
    session.timeRange = range
    session.shouldOptimizeForNetworkUse = true
    job.onCancel = { session.cancelExport() }
    let timer = DispatchSource.makeTimerSource(queue: .global())
    timer.schedule(deadline: .now(), repeating: .milliseconds(250))
    timer.setEventHandler { self.progress(jobId, Double(session.progress)) }
    timer.resume()
    defer { timer.cancel() }
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      session.exportAsynchronously { continuation.resume() }
    }
    switch session.status {
    case .completed:
      return
    case .cancelled:
      throw MediaCancelledException()
    default:
      if job.backgrounded { throw MediaInterruptedException() }
      throw MediaFailedException(session.error?.localizedDescription ?? "export")
    }
  }

  // MARK: - thumbnails

  static func thumbnails(_ uri: URL, timesMs: [Double], maxSide: Double, directory: URL) async throws -> [String] {
    let asset = AVURLAsset(url: uri)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: maxSide, height: maxSide)
    // 时间轴上的缩略图不需要准确到帧，放宽一点快很多。
    let tolerance = CMTime(seconds: 0.5, preferredTimescale: 600)
    generator.requestedTimeToleranceBefore = tolerance
    generator.requestedTimeToleranceAfter = tolerance
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var uris: [String] = []
    for ms in timesMs {
      let time = CMTime(seconds: ms / 1000, preferredTimescale: 600)
      let image: CGImage
      do {
        image = try await generator.image(at: time).image
      } catch {
        throw MediaUnsupportedException(error.localizedDescription)
      }
      guard let data = UIImage(cgImage: image).jpegData(compressionQuality: 0.7) else {
        throw MediaFailedException("jpeg")
      }
      let file = directory.appendingPathComponent("\(UUID().uuidString).jpg")
      try data.write(to: file)
      uris.append(file.absoluteString)
    }
    return uris
  }
}
