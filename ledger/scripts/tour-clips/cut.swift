import AVFoundation
// usage: cut.swift in out width  seg... where seg = from:to:speed
let a = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let outURL = URL(fileURLWithPath: a[2]); try? FileManager.default.removeItem(at: outURL)
let width = Double(a[3])!
let src = asset.tracks(withMediaType: .video)[0]
let comp = AVMutableComposition()
let track = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
var cursor = CMTime.zero
func T(_ s: Double) -> CMTime { CMTime(seconds: s, preferredTimescale: 600) }
for seg in a[4...] where !seg.hasPrefix("--") {
  let p = seg.split(separator: ":").map { Double($0)! }
  let range = CMTimeRange(start: T(p[0]), end: T(p[1]))
  try! track.insertTimeRange(range, of: src, at: cursor)
  let outDur = T((p[1] - p[0]) / p[2])
  track.scaleTimeRange(CMTimeRange(start: cursor, duration: range.duration), toDuration: outDur)
  cursor = CMTimeAdd(cursor, outDur)
}
let nat = src.naturalSize.applying(src.preferredTransform)
let w0 = abs(nat.width), h0 = abs(nat.height)
let scale = width / Double(w0)
let W = Int(width / 2) * 2, H = Int(Double(h0) * scale / 2) * 2
let vc = AVMutableVideoComposition()
vc.renderSize = CGSize(width: W, height: H)
vc.frameDuration = CMTime(value: 1, timescale: 30)
let ins = AVMutableVideoCompositionInstruction()
ins.timeRange = CMTimeRange(start: .zero, duration: cursor)
let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
layer.setTransform(src.preferredTransform.concatenating(CGAffineTransform(scaleX: CGFloat(scale), y: CGFloat(scale))), at: .zero)
ins.layerInstructions = [layer]
vc.instructions = [ins]
let kbps = Double(a.last!.hasPrefix("--kbps=") ? String(a.last!.dropFirst(7)) : "1000")!
let reader = try! AVAssetReader(asset: comp)
let rout = AVAssetReaderVideoCompositionOutput(videoTracks: [track], videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
rout.videoComposition = vc
reader.add(rout)
let writer = try! AVAssetWriter(outputURL: outURL, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true
let win = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: kbps * 1000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 60] as [String: Any]])
win.expectsMediaDataInRealTime = false
writer.add(win)
reader.startReading(); writer.startWriting(); writer.startSession(atSourceTime: .zero)
let sem = DispatchSemaphore(value: 0)
win.requestMediaDataWhenReady(on: DispatchQueue(label: "w")) {
  while win.isReadyForMoreMediaData {
    if let buf = rout.copyNextSampleBuffer() { win.append(buf) }
    else { win.markAsFinished(); writer.finishWriting { sem.signal() }; return }
  }
}
sem.wait()
print(writer.status == .completed ? "ok \(W)x\(H) \(CMTimeGetSeconds(cursor))s" : "failed \(String(describing: writer.error)) \(String(describing: reader.error))")
