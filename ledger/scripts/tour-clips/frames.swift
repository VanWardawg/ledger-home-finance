import AVFoundation
import AppKit
let a = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let out = a[2]; let step = Double(a[3])!; let width = CGFloat(Double(a[4])!)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero; gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: width, height: width * 3)
let dur = CMTimeGetSeconds(asset.duration)
var t = 0.0; var i = 0
let from = a.count > 5 ? Double(a[5])! : 0, to = a.count > 6 ? Double(a[6])! : dur
t = from
while t < min(to, dur) {
  if let cg = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) {
    let rep = NSBitmapImageRep(cgImage: cg)
    let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.6])!
    try! data.write(to: URL(fileURLWithPath: String(format: "%@/f%03d_%05.1f.jpg", out, i, t)))
  }
  t += step; i += 1
}
print("duration", dur)
