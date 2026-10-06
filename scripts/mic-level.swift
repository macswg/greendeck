// Prints the default microphone's level as "rms peak" lines (each 0–1),
// about 50 times a second, until stdin closes or it's killed. Used by
// src/mic.ts, which compiles it on first use.
//
// The first run asks for microphone access for whichever app launched
// greendeck (your terminal). If it's denied, the levels just stay at 0.
import AVFoundation
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let engine = AVAudioEngine()
let input = engine.inputNode
let format = input.outputFormat(forBus: 0)
guard format.sampleRate > 0, format.channelCount > 0 else {
  FileHandle.standardError.write("mic-level: no input device\n".data(using: .utf8)!)
  exit(1)
}

// A sink node gets the input in small hardware-sized buffers (a tap batches
// them into ~100 ms chunks, too coarse for a meter). Readings go out every
// ~20 ms of audio.
let window = Int(format.sampleRate / 50)
var sum: Float = 0
var peak: Float = 0
var count = 0
let sink = AVAudioSinkNode { _, frameCount, bufferList in
  let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: bufferList))
  // Channel 0 is enough for a level meter.
  guard let raw = buffers.first?.mData else { return noErr }
  let ch = raw.assumingMemoryBound(to: Float.self)
  for i in 0..<Int(frameCount) {
    let v = ch[i]
    sum += v * v
    peak = max(peak, abs(v))
    count += 1
    if count >= window {
      print(String(format: "%.5f %.5f", sqrt(sum / Float(count)), min(peak, 1)))
      sum = 0
      peak = 0
      count = 0
    }
  }
  return noErr
}
engine.attach(sink)
engine.connect(input, to: sink, format: nil)

do {
  try engine.start()
} catch {
  FileHandle.standardError.write("mic-level: \(error.localizedDescription)\n".data(using: .utf8)!)
  exit(1)
}

// Quit when greendeck goes away (stdin closes).
DispatchQueue.global().async {
  while readLine() != nil {}
  exit(0)
}
dispatchMain()
