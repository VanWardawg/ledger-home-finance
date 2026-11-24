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
import CoreImage
// Bands to hide, by time in the finished film: from, to, top, bottom (fractions of the height from the top), left, right.
let bands: [(Double, Double, Double, Double, Double, Double)] = [
  (0.0, 0.90, 0.495, 0.675, 0.03, 0.98),
  (0.90, 1.25, 0.215, 0.675, 0.0, 1.0),
  (1.25, 1.70, 0.215, 0.385, 0.0, 1.0),
  (1.70, 1.90, 0.165, 0.385, 0.0, 1.0),
  (1.86, 2.14, 0.165, 0.315, 0.0, 1.0),
  (2.14, 2.30, 0.165, 0.275, 0.0, 1.0),
]
let vc = AVMutableVideoComposition(asset: comp) { req in
  let t = CMTimeGetSeconds(req.compositionTime)
  var img = req.sourceImage
  let ext = img.extent
  for b in bands where t >= b.0 - 0.02 && t < b.1 + 0.02 {
    let r = CGRect(x: ext.minX + ext.width * b.4, y: ext.minY + ext.height * (1 - b.3), width: ext.width * (b.5 - b.4), height: ext.height * (b.3 - b.2))
    let hidden = img.cropped(to: r).clampedToExtent()
      .applyingFilter("CIPixellate", parameters: [kCIInputScaleKey: 170, kCIInputCenterKey: CIVector(x: r.midX, y: r.midY)])
      .applyingGaussianBlur(sigma: 70).cropped(to: r)
    // An opaque backing first: without it the band came out see-through and the names showed faintly.
    let solid = CIImage(color: CIColor(red: 0.13, green: 0.13, blue: 0.14, alpha: 1)).cropped(to: r)
    img = hidden.composited(over: solid).composited(over: img)
  }
  req.finish(with: img.transformed(by: CGAffineTransform(scaleX: CGFloat(scale), y: CGFloat(scale))).cropped(to: CGRect(x: 0, y: 0, width: W, height: H)), context: nil)
}
vc.renderSize = CGSize(width: W, height: H)
vc.frameDuration = CMTime(value: 1, timescale: 30)
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
